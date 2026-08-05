import { resolve } from "node:path";
import { decryptFromPubkey } from "./agents/crypto.js";
import type { ExternalAgentDef } from "./agents/definition.js";
import { fetchExternalAgentDefs } from "./agents/definitions-poller.js";
import { BuzzCli } from "./buzz/cli-client.js";
import { parseAgentProfile } from "./engine/agent-profile.js";
import { completeReply } from "./engine/llm.js";
import { AgentRuntime, type RuntimeAgent } from "./engine/runtime.js";
import { parseOperatorPubkeys } from "./identity.js";
import { acquireLock } from "./lock.js";
import { registerRelayMember } from "./buzz/nip43.js";
import { writeHeartbeat } from "./heartbeat.js";
import { Router, sourceLeadKeyPrefix } from "./router.js";
import { SourceManager, type StartedSource } from "./sources/source-manager.js";
import { decideStartup } from "./startup.js";
import { StateStore } from "./state.js";
import { StubTelegram } from "./telegram/stub.js";
import { TelegramChannel } from "./telegram/real.js";
import type { InboundSource, OutboundSink } from "./types.js";

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

function requireEnv(name: string): string {
  const v = env(name);
  if (!v) {
    console.error(
      `[oura-bridge] не задан обязательный env ${name} (сгенерируй пару: pnpm --filter @oura/bridge mint-key)`,
    );
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const serviceNsec = requireEnv("OURA_SERVICE_NSEC");
  const servicePubkeyHex = requireEnv("OURA_SERVICE_PUBKEY");
  const relayUrl = env("OURA_RELAY_URL") ?? "http://localhost:3000";
  const binPath =
    env("OURA_BUZZ_BIN") ??
    resolve(import.meta.dirname, "../../../target/debug/buzz");
  const stubPort = Number(env("OURA_STUB_PORT") ?? "8787");
  const statePath =
    env("OURA_STATE_FILE") ?? resolve(process.cwd(), "bridge.state.json");
  const pollMs = Number(env("OURA_POLL_MS") ?? "2000");
  const defsPollMs = Number(env("OURA_DEFS_POLL_MS") ?? "30000");
  const leadActiveWindowMs = Number(
    env("OURA_LEAD_ACTIVE_WINDOW_MS") ?? String(30 * 24 * 60 * 60 * 1000),
  );
  const sourcesFromUi = env("OURA_SOURCES_FROM_UI") === "true";
  // Движок отвечает клиентам вместо оператора. Работает только вместе с
  // источниками из UI: агент без описания на relay — это некому отвечать.
  const agentEngine = env("OURA_AGENT_ENGINE") === "true" && sourcesFromUi;
  const agentAutoReply = env("OURA_AGENT_AUTO_REPLY") === "true";
  const agentModel = env("OURA_AGENT_MODEL") ?? "claude-sonnet-5";
  const agentApiKey = env("OURA_AGENT_API_KEY") ?? env("ANTHROPIC_API_KEY");
  if (agentEngine && !agentApiKey) {
    console.error(
      "[oura-bridge] OURA_AGENT_ENGINE=true, но не задан OURA_AGENT_API_KEY — отвечать нечем",
    );
    process.exit(1);
  }
  if (env("OURA_AGENT_ENGINE") === "true" && !sourcesFromUi) {
    console.error(
      "[oura-bridge] OURA_AGENT_ENGINE требует OURA_SOURCES_FROM_UI=true",
    );
    process.exit(1);
  }

  // B6: гард от второго инстанса над тем же state-файлом — до загрузки state
  const lock = await acquireLock(`${statePath}.lock`);
  const state = await StateStore.load(statePath);
  const buzz = new BuzzCli({ binPath, relayUrl });

  const { valid: operatorPubkeys, invalid: invalidOperatorPubkeys } =
    parseOperatorPubkeys(
      env("OURA_OPERATOR_PUBKEYS") ?? env("OURA_OPERATOR_PUBKEY") ?? "",
    );
  if (invalidOperatorPubkeys.length > 0) {
    console.error(
      `[oura-bridge] OURA_OPERATOR_PUBKEYS: не hex-pubkey (64 hex-символа): ${invalidOperatorPubkeys.join(", ")}`,
    );
    process.exit(1);
  }

  const startup = decideStartup({
    source: env("OURA_SOURCE"),
    operatorPubkeys,
    sourcesFromUi,
  });
  if (!startup.ok) {
    for (const error of startup.errors) {
      console.error(`[oura-bridge] ${error}`);
    }
    process.exit(1);
  }
  for (const warning of startup.warnings) {
    console.warn(`[oura-bridge] ${warning}`);
  }

  // NIP-43 (этап 2Б): регистрация лид-ключей участниками relay — обязательна
  // перед включением BUZZ_REQUIRE_RELAY_MEMBERSHIP=true; сервисный ключ должен
  // быть admin/owner relay
  const registerMembership = env("OURA_REGISTER_LEAD_MEMBERSHIP") === "true";
  const registerLeadMembership = registerMembership
    ? (leadPubkeyHex: string): Promise<void> =>
        registerRelayMember({ relayUrl, serviceNsec, leadPubkeyHex })
    : undefined;
  if (registerMembership) {
    // лиды, онбордившиеся до включения флага, регистрируются на старте;
    // сбой не роняет мост — поллинг переживает недоступность relay, а
    // незарегистрированный лид виден по этому warn до следующего рестарта
    for (const lead of state.activeLeads(Date.now(), leadActiveWindowMs)) {
      try {
        await registerRelayMember({
          relayUrl,
          serviceNsec,
          leadPubkeyHex: lead.pubkeyHex,
        });
      } catch (e) {
        console.warn(
          `[oura-bridge] стартовая NIP-43-регистрация лида ${lead.chatId} не удалась:`,
          e,
        );
      }
    }
  }

  // Роутеры, которые обходит цикл pollOutbound: легаси (если поднят) + по
  // одному на каждого запущенного бота внешнего агента.
  const routers = new Map<string, Router>();

  // --- легаси-канал из env (OURA_SOURCE), как раньше ---
  let legacyChannel: (InboundSource & OutboundSink) | undefined;
  let stub: StubTelegram | undefined;
  if (startup.source !== undefined) {
    if (startup.source === "telegram") {
      legacyChannel = new TelegramChannel(requireEnv("OURA_TELEGRAM_TOKEN"));
    } else {
      stub = new StubTelegram(stubPort);
      legacyChannel = stub;
    }
    const legacyRouter = new Router({
      buzz,
      state,
      sink: legacyChannel,
      serviceNsec,
      servicePubkeyHex,
      operatorPubkeys,
      leadActiveWindowMs,
      registerLeadMembership,
    });
    routers.set("", legacyRouter);
    await legacyChannel.start(async (m) => {
      try {
        await legacyRouter.handleInbound(m);
        // имя клиента в лог не пишем — PII; идентификация по chatId
        console.log(`[inbound] chat ${m.chatId} → комната лида`);
      } catch (e) {
        console.error(`[inbound] ошибка обработки chat ${m.chatId}:`, e);
      }
    });
  }

  // --- источники из UI: боты внешних агентов из описаний на relay ---
  // Движок держит по рантайму на бота (у каждого свой канал доставки) и
  // берёт свежее описание агента из последнего снапшота.
  const runtimes = new Map<string, AgentRuntime>();
  const agentDefs = new Map<string, ExternalAgentDef>();
  let sourceManager: SourceManager | undefined;
  let defsTimer: NodeJS.Timeout | undefined;
  if (sourcesFromUi) {
    sourceManager = new SourceManager({
      decryptToken: (def: ExternalAgentDef): string => {
        if (
          def.encTargetPubkey.toLowerCase() !== servicePubkeyHex.toLowerCase()
        ) {
          throw new Error(
            `токен шифрован для ${def.encTargetPubkey.slice(0, 8)}…, а не для сервиса моста`,
          );
        }
        return decryptFromPubkey(serviceNsec, def.ownerPubkey, def.botTokenEnc);
      },
      factory: {
        async create(
          def: ExternalAgentDef,
          token: string,
        ): Promise<StartedSource> {
          const channel = new TelegramChannel(token);
          const router = new Router({
            buzz,
            state,
            sink: channel,
            serviceNsec,
            servicePubkeyHex,
            operatorPubkeys,
            leadActiveWindowMs,
            registerLeadMembership,
            leadKeyPrefix: sourceLeadKeyPrefix(def.agentId),
          });
          // start() делает getMe fail-fast: мёртвый токен = ошибка старта
          await channel.start(async (m) => {
            try {
              await router.handleInbound(m);
              console.log(
                `[inbound:${def.agentId}] chat ${m.chatId} → комната лида`,
              );
            } catch (e) {
              console.error(
                `[inbound:${def.agentId}] ошибка обработки chat ${m.chatId}:`,
                e,
              );
            }
          });
          routers.set(def.agentId, router);
          if (agentEngine && agentApiKey) {
            runtimes.set(
              def.agentId,
              new AgentRuntime({
                buzz,
                state,
                sink: channel,
                relayUrl,
                serviceNsec,
                servicePubkeyHex,
                operatorPubkeys,
                leadActiveWindowMs,
                autoReply: agentAutoReply,
                registerMember: registerLeadMembership,
                complete: (call) =>
                  completeReply({
                    apiKey: agentApiKey,
                    model: agentModel,
                    systemPrompt: call.systemPrompt,
                    history: call.history,
                    userMessage: call.userMessage,
                  }),
              }),
            );
          }
          return {
            async stop() {
              routers.delete(def.agentId);
              runtimes.delete(def.agentId);
              await channel.stop();
            },
          };
        },
      },
    });

    const syncDefs = async (): Promise<void> => {
      try {
        const defs = await fetchExternalAgentDefs({ relayUrl, serviceNsec });
        agentDefs.clear();
        for (const def of defs) agentDefs.set(def.agentId, def);
        await sourceManager?.reconcile(defs);
      } catch (e) {
        // relay недоступен — работаем со старым набором ботов до следующего цикла
        console.warn("[sources] снапшот описаний агентов не получен:", e);
      }
    };
    await syncDefs();
    defsTimer = setInterval(() => void syncDefs(), defsPollMs);
  }

  const heartbeatPath = env("OURA_HEARTBEAT_FILE");
  let polling = false;
  let pollPromise: Promise<void> = Promise.resolve();
  const timer = setInterval(() => {
    if (polling) return;
    polling = true;
    pollPromise = (async () => {
      for (const router of routers.values()) {
        await router.pollOutbound();
      }
      for (const [agentId, runtime] of runtimes) {
        const def = agentDefs.get(agentId);
        if (!def) continue;
        const agent: RuntimeAgent = {
          agentId: def.agentId,
          name: def.name,
          isActive: def.isActive,
          profile: parseAgentProfile(def.profile),
        };
        try {
          await runtime.tick(agent);
        } catch (e) {
          // сбой одного агента не должен останавливать поллинг остальных
          console.error(`[движок] агент ${agentId}: цикл не выполнен:`, e);
        }
      }
      if (heartbeatPath) await writeHeartbeat(heartbeatPath, Date.now());
    })()
      .catch((e) => console.error("[poll] ошибка:", e))
      .finally(() => {
        polling = false;
      });
  }, pollMs);

  const shutdown = async (): Promise<void> => {
    clearInterval(timer);
    if (defsTimer) clearInterval(defsTimer);
    try {
      await pollPromise;
      await legacyChannel?.stop();
      await sourceManager?.stopAll();
      await state.save();
      await lock.release();
      process.exit(0);
    } catch (e) {
      console.error("[oura-bridge] ошибка при остановке:", e);
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  if (stub) {
    console.log(
      `[oura-bridge] заглушка Telegram: http://127.0.0.1:${stub.port} (POST /simulate, GET /outbox)`,
    );
  } else if (startup.source === "telegram") {
    console.log("[oura-bridge] источник: Telegram (long-polling)");
  }
  if (sourcesFromUi) {
    console.log(
      `[oura-bridge] источники из UI включены (поллинг описаний: ${defsPollMs}ms)`,
    );
  }
  if (agentEngine) {
    console.log(
      `[oura-bridge] движок агентов включён: модель ${agentModel}, режим ${agentAutoReply ? "без одобрения" : "черновики"}`,
    );
  }
  console.log(
    `[oura-bridge] relay: ${relayUrl}, buzz-cli: ${binPath}, поллинг: ${pollMs}ms`,
  );
}

void main();
