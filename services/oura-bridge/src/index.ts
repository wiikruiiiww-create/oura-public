import { resolve } from "node:path";
import { BuzzCli } from "./buzz/cli-client.js";
import { parseOperatorPubkeys } from "./identity.js";
import { Router } from "./router.js";
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

  const state = await StateStore.load(statePath);
  const buzz = new BuzzCli({ binPath, relayUrl });

  const sourceKind = env("OURA_SOURCE") ?? "stub";
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

  let channel: InboundSource & OutboundSink;
  let stub: StubTelegram | undefined;
  if (sourceKind === "telegram") {
    channel = new TelegramChannel(requireEnv("OURA_TELEGRAM_TOKEN"));
  } else if (sourceKind === "stub") {
    stub = new StubTelegram(stubPort);
    channel = stub;
  } else {
    console.error(
      `[oura-bridge] неизвестный OURA_SOURCE=${sourceKind} (допустимо: stub | telegram)`,
    );
    process.exit(1);
  }

  const router = new Router({
    buzz,
    state,
    sink: channel,
    serviceNsec,
    servicePubkeyHex,
    operatorPubkeys,
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
  if (operatorPubkeys.length === 0) {
    console.warn(
      "[oura-bridge] OURA_OPERATOR_PUBKEYS пуст — клиенту ретранслируется любой участник канала (режим дев-стенда)",
    );
  }
  console.log(
    `[oura-bridge] relay: ${relayUrl}, buzz-cli: ${binPath}, поллинг: ${pollMs}ms`,
  );
}

void main();
