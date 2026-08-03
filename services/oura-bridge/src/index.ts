import { resolve } from "node:path";
import { BuzzCli } from "./buzz/cli-client.js";
import { parseOperatorPubkeys } from "./identity.js";
import { acquireLock } from "./lock.js";
import { registerRelayMember } from "./buzz/nip43.js";
import { Router } from "./router.js";
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
  const leadActiveWindowMs = Number(
    env("OURA_LEAD_ACTIVE_WINDOW_MS") ?? String(30 * 24 * 60 * 60 * 1000),
  );

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

  let channel: InboundSource & OutboundSink;
  let stub: StubTelegram | undefined;
  if (startup.source === "telegram") {
    channel = new TelegramChannel(requireEnv("OURA_TELEGRAM_TOKEN"));
  } else {
    stub = new StubTelegram(stubPort);
    channel = stub;
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

  const router = new Router({
    buzz,
    state,
    sink: channel,
    serviceNsec,
    servicePubkeyHex,
    operatorPubkeys,
    leadActiveWindowMs,
    registerLeadMembership,
  });

  await channel.start(async (m) => {
    try {
      await router.handleInbound(m);
      console.log(`[inbound] chat ${m.chatId} (${m.name}) → комната лида`);
    } catch (e) {
      console.error(`[inbound] ошибка обработки chat ${m.chatId}:`, e);
    }
  });

  let polling = false;
  let pollPromise: Promise<void> = Promise.resolve();
  const timer = setInterval(() => {
    if (polling) return;
    polling = true;
    pollPromise = router
      .pollOutbound()
      .catch((e) => console.error("[poll] ошибка:", e))
      .finally(() => {
        polling = false;
      });
  }, pollMs);

  const shutdown = async (): Promise<void> => {
    clearInterval(timer);
    try {
      await pollPromise;
      await channel.stop();
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
  } else {
    console.log("[oura-bridge] источник: Telegram (long-polling)");
  }
  console.log(
    `[oura-bridge] relay: ${relayUrl}, buzz-cli: ${binPath}, поллинг: ${pollMs}ms`,
  );
}

void main();
