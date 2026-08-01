import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { BuzzCli, BuzzCliError } from "../src/buzz/cli-client.js";

const fixture = fileURLToPath(
  new URL("./fixtures/fake-buzz.mjs", import.meta.url),
);
let logFile: string;
let messagesFile: string;

function makeCli(): BuzzCli {
  return new BuzzCli({
    binPath: process.execPath,
    binArgs: [fixture],
    relayUrl: "http://relay.test",
  });
}

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "oura-cli-"));
  logFile = join(dir, "calls.jsonl");
  messagesFile = join(dir, "messages.json");
  process.env.FAKE_BUZZ_LOG = logFile;
  process.env.FAKE_BUZZ_MESSAGES = messagesFile;
  delete process.env.FAKE_BUZZ_EXIT;
  delete process.env.FAKE_BUZZ_HANG;
});

describe("BuzzCli", () => {
  it("createChannel возвращает id и передаёт nsec через env", async () => {
    const id = await makeCli().createChannel("nsec1aaa", "inbox-иван-42");
    expect(id).toBe("11111111-1111-1111-1111-111111111111");
    const call = JSON.parse(readFileSync(logFile, "utf8").trim());
    expect(call.args).toEqual([
      "channels",
      "create",
      "--name",
      "inbox-иван-42",
      "--type",
      "stream",
      "--visibility",
      "open",
    ]);
    expect(call.privateKey).toBe("nsec1aaa");
    expect(call.relayUrl).toBe("http://relay.test");
  });

  it("sendMessage вызывает messages send с контентом", async () => {
    await makeCli().sendMessage("nsec1bbb", "chan-1", "Здравствуйте!");
    const call = JSON.parse(readFileSync(logFile, "utf8").trim());
    expect(call.args).toEqual([
      "messages",
      "send",
      "--channel",
      "chan-1",
      "--content",
      "Здравствуйте!",
    ]);
  });

  it("getMessages нормализует поля id/pubkey/content/created_at", async () => {
    writeFileSync(
      messagesFile,
      JSON.stringify([
        { id: "ev1", pubkey: "pkA", content: "привет", created_at: 100 },
        { event_id: "ev2", author: "pkB", content: "ответ", created_at: 200 },
      ]),
    );
    const msgs = await makeCli().getMessages("nsec1ccc", "chan-1", 10);
    expect(msgs).toEqual([
      { id: "ev1", authorPubkey: "pkA", content: "привет", createdAt: 100 },
      { id: "ev2", authorPubkey: "pkB", content: "ответ", createdAt: 200 },
    ]);
  });

  it("ненулевой exit-код превращается в BuzzCliError с кодом и stderr", async () => {
    process.env.FAKE_BUZZ_EXIT = "3";
    await expect(
      makeCli().sendMessage("nsec1ddd", "chan-1", "x"),
    ).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(BuzzCliError);
      expect((e as BuzzCliError).code).toBe(3);
      return true;
    });
  });

  it("trySetProfile глотает ошибку (профиль — необязательная косметика)", async () => {
    process.env.FAKE_BUZZ_EXIT = "1";
    await expect(
      makeCli().trySetProfile("nsec1eee", "Иван"),
    ).resolves.toBeUndefined();
  });

  it("зависший buzz-cli отклоняется BuzzCliError по timeout, а не висит вечно", async () => {
    process.env.FAKE_BUZZ_HANG = "1";
    const cli = new BuzzCli({
      binPath: process.execPath,
      binArgs: [fixture],
      relayUrl: "http://relay.test",
      timeoutMs: 200,
    });
    await expect(
      cli.sendMessage("nsec1fff", "chan-1", "x"),
    ).rejects.toBeInstanceOf(BuzzCliError);
  });
});
