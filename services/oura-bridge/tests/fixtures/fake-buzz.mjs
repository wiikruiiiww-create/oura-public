// Эмулятор buzz-cli для юнит-тестов: пишет вызов в FAKE_BUZZ_LOG (JSONL),
// отвечает канонным JSON по подкоманде. FAKE_BUZZ_EXIT=<n> имитирует ошибку.
// FAKE_BUZZ_HANG=1 имитирует зависший процесс (не завершается сам).
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
appendFileSync(
  process.env.FAKE_BUZZ_LOG,
  `${JSON.stringify({ args, privateKey: process.env.BUZZ_PRIVATE_KEY, relayUrl: process.env.BUZZ_RELAY_URL })}\n`,
);

if (process.env.FAKE_BUZZ_HANG === "1") {
  // Эмулирует зависший buzz-cli (relay не отвечает): процесс сам никогда не
  // завершается, ждём принудительного kill по timeout execFile в cli-client.ts.
  setInterval(() => {}, 1_000_000);
} else {
  const exit = Number(process.env.FAKE_BUZZ_EXIT ?? "0");
  if (exit !== 0) {
    process.stderr.write(JSON.stringify({ error: "fake failure" }));
    process.exit(exit);
  }

  const [group, sub] = args;
  if (group === "channels" && sub === "create") {
    process.stdout.write(
      JSON.stringify({ id: "11111111-1111-1111-1111-111111111111" }),
    );
  } else if (group === "messages" && sub === "get") {
    const f = process.env.FAKE_BUZZ_MESSAGES;
    process.stdout.write(f && existsSync(f) ? readFileSync(f, "utf8") : "[]");
  } else {
    process.stdout.write("{}");
  }
}
