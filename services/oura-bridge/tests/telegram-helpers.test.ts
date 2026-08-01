import { GrammyError, HttpError } from "grammy";
import { describe, expect, it } from "vitest";
import {
  chunkText,
  isRetryable,
  sendWithRetry,
  toInbound,
} from "../src/telegram/helpers.js";

describe("toInbound", () => {
  it("маппит chat.id/first_name/text в контракт InboundMessage", () => {
    expect(
      toInbound({
        chat: { id: 42 },
        from: { first_name: "Иван" },
        text: "привет",
      }),
    ).toEqual({ chatId: "42", name: "Иван", text: "привет" });
  });

  it("подставляет «Клиент» при пустом/отсутствующем имени", () => {
    expect(toInbound({ chat: { id: 1 }, text: "x" }).name).toBe("Клиент");
    expect(
      toInbound({ chat: { id: 1 }, from: { first_name: "  " }, text: "x" })
        .name,
    ).toBe("Клиент");
  });
});

describe("chunkText", () => {
  it("короткий текст — один кусок", () => {
    expect(chunkText("привет")).toEqual(["привет"]);
  });

  it("режет по границе строки, куски не длиннее лимита, текст не теряется", () => {
    const text = `${"а".repeat(3000)}\n${"б".repeat(3000)}`;
    const chunks = chunkText(text, 4096);
    expect(chunks.length).toBe(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(4096);
    expect(chunks.join("")).toBe(text.replace("\n", ""));
  });

  it("сплошной текст без пробелов режет жёстко по лимиту", () => {
    const chunks = chunkText("x".repeat(9000), 4096);
    expect(chunks.map((c) => c.length)).toEqual([4096, 4096, 808]);
  });
});

// Если сигнатура конструктора GrammyError/HttpError в установленной версии
// отличается — поправь конструирование здесь, контракт isRetryable не меняй.
function grammyErr(code: number, retryAfter?: number): GrammyError {
  return new GrammyError(
    `test ${code}`,
    {
      ok: false,
      error_code: code,
      description: "test",
      ...(retryAfter !== undefined
        ? { parameters: { retry_after: retryAfter } }
        : {}),
    },
    "sendMessage",
    {},
  );
}

describe("isRetryable", () => {
  it("сетевые ошибки (HttpError) — ретраятся", () => {
    expect(isRetryable(new HttpError("boom", new Error("ECONNRESET")))).toBe(
      true,
    );
  });

  it("429/5xx — ретраятся, 403/400 — нет", () => {
    expect(isRetryable(grammyErr(429))).toBe(true);
    expect(isRetryable(grammyErr(502))).toBe(true);
    expect(isRetryable(grammyErr(403))).toBe(false);
    expect(isRetryable(grammyErr(400))).toBe(false);
    expect(isRetryable(new Error("что угодно"))).toBe(false);
  });
});

describe("sendWithRetry", () => {
  it("успех со второй попытки после retryable-ошибки", async () => {
    const delays: number[] = [];
    let calls = 0;
    const result = await sendWithRetry(
      async () => {
        calls++;
        if (calls === 1) throw grammyErr(500);
        return "ok";
      },
      { sleep: async (ms) => void delays.push(ms) },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
    expect(delays.length).toBe(1);
  });

  it("non-retryable бросается сразу, без повторов", async () => {
    let calls = 0;
    await expect(
      sendWithRetry(
        async () => {
          calls++;
          throw grammyErr(403);
        },
        { sleep: async () => {} },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("уважает retry_after от Telegram (429)", async () => {
    const delays: number[] = [];
    let calls = 0;
    await sendWithRetry(
      async () => {
        calls++;
        if (calls === 1) throw grammyErr(429, 7);
        return "ok";
      },
      { sleep: async (ms) => void delays.push(ms) },
    );
    expect(delays).toEqual([7000]);
  });

  it("после maxAttempts бросает последнюю ошибку", async () => {
    let calls = 0;
    await expect(
      sendWithRetry(
        async () => {
          calls++;
          throw grammyErr(500);
        },
        { maxAttempts: 3, sleep: async () => {} },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(3);
  });
});
