import { resolve } from "node:path";
import { BuzzCli } from "./buzz/cli-client.js";
import { Router } from "./router.js";
import { StateStore } from "./state.js";
import { StubTelegram } from "./telegram/stub.js";

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

function requireEnv(name: string): string {
  const v = env(name);
  if (!v) {
    console.error(`[oura-bridge] не задан обязательный env ${name} (сгенерируй пару: pnpm --filter @oura/bridge mint-key)`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const serviceNsec = requireEnv("OURA_SERVICE_NSEC");
  const servicePubkeyHex = requireEnv("OURA_SERVICE_PUBKEY");
  const relayUrl = env("OURA_RELAY_URL") ?? "http://localhost:3000";
  const binPath = env("OURA_BUZZ_BIN") ?? resolve(import.meta.dirname, "../../../target/debug/buzz");
  const stubPort = Number(env("OURA_STUB_PORT") ?? "8787");
  const statePath = env("OURA_STATE_FILE") ?? resolve(process.cwd(), "bridge.state.json");
  const pollMs = Number(env("OURA_POLL_MS") ?? "2000");

  const state = await StateStore.load(statePath);
  const buzz = new BuzzCli({ binPath, relayUrl });
  const stub = new StubTelegram(stubPort);
  const router = new Router({
    buzz,
    state,
    sink: stub,
    serviceNsec,
    servicePubkeyHex,
    operatorPubkeyHex: env("OURA_OPERATOR_PUBKEY"),
  });

  await stub.start(async (m) => {
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
      await stub.stop();
      await state.save();
      process.exit(0);
    } catch (e) {
      console.error("[oura-bridge] ошибка при остановке:", e);
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  console.log(`[oura-bridge] заглушка Telegram: http://127.0.0.1:${stub.port} (POST /simulate, GET /outbox)`);
  console.log(`[oura-bridge] relay: ${relayUrl}, buzz-cli: ${binPath}, поллинг: ${pollMs}ms`);
}

void main();
