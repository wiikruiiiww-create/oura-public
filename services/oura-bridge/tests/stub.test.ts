import { afterEach, describe, expect, it } from "vitest";
import type { InboundMessage } from "../src/types.js";
import { StubTelegram } from "../src/telegram/stub.js";

let stub: StubTelegram;
afterEach(async () => {
  await stub.stop();
});

describe("StubTelegram", () => {
  it("POST /simulate доставляет входящее в onMessage", async () => {
    stub = new StubTelegram(0);
    const got: InboundMessage[] = [];
    await stub.start(async (m) => {
      got.push(m);
    });
    const res = await fetch(`http://127.0.0.1:${stub.port}/simulate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chatId: "42",
        name: "Иван",
        text: "Здравствуйте!",
      }),
    });
    expect(res.status).toBe(202);
    expect(got).toEqual([
      { chatId: "42", name: "Иван", text: "Здравствуйте!" },
    ]);
  });

  it("deliver кладёт исходящее в outbox, DELETE очищает", async () => {
    stub = new StubTelegram(0);
    await stub.start(async () => {});
    await stub.deliver({ chatId: "42", text: "Добрый день, чем помочь?" });
    const out = await (
      await fetch(`http://127.0.0.1:${stub.port}/outbox`)
    ).json();
    expect(out).toEqual([{ chatId: "42", text: "Добрый день, чем помочь?" }]);
    await fetch(`http://127.0.0.1:${stub.port}/outbox`, { method: "DELETE" });
    const empty = await (
      await fetch(`http://127.0.0.1:${stub.port}/outbox`)
    ).json();
    expect(empty).toEqual([]);
  });

  it("битый JSON и не те поля дают 400", async () => {
    stub = new StubTelegram(0);
    await stub.start(async () => {});
    const bad = await fetch(`http://127.0.0.1:${stub.port}/simulate`, {
      method: "POST",
      body: "не json",
    });
    expect(bad.status).toBe(400);
    const missing = await fetch(`http://127.0.0.1:${stub.port}/simulate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: "42" }),
    });
    expect(missing.status).toBe(400);
  });
});
