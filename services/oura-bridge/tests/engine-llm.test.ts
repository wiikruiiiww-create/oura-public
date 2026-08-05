import { describe, expect, it } from "vitest";
import { completeReply, LlmError } from "../src/engine/llm.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const okBody = {
  content: [{ type: "text", text: "Здравствуйте! Чем помочь?" }],
  usage: { input_tokens: 120, output_tokens: 15 },
};

const baseInput = {
  apiKey: "sk-test",
  model: "claude-sonnet-5",
  systemPrompt: "Ты — менеджер",
  history: [
    { role: "user" as const, content: "привет" },
    { role: "assistant" as const, content: "Здравствуйте!" },
  ],
  userMessage: "сколько стоит?",
};

describe("вызов модели", () => {
  it("шлёт системный промпт, историю и сообщение клиента", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: unknown, init?: unknown) => {
      calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
      return jsonResponse(okBody);
    }) as typeof fetch;

    const result = await completeReply({ ...baseInput, fetchImpl });

    expect(result.text).toBe("Здравствуйте! Чем помочь?");
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 15 });

    const body = JSON.parse(String(calls[0].init.body));
    expect(calls[0].url).toContain("/v1/messages");
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.system).toBe("Ты — менеджер");
    expect(body.messages).toEqual([
      { role: "user", content: "привет" },
      { role: "assistant", content: "Здравствуйте!" },
      { role: "user", content: "сколько стоит?" },
    ]);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["anthropic-version"]).toBeTruthy();
  });

  it("ключ не попадает в текст ошибки", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ error: { message: "bad" } }, 401)) as typeof fetch;
    await expect(
      completeReply({ ...baseInput, fetchImpl, maxRetries: 0 }),
    ).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(LlmError);
      expect(String(e)).not.toContain("sk-test");
      return true;
    });
  });

  it("429 ретраится и в итоге отвечает", async () => {
    let attempt = 0;
    const fetchImpl = (async () => {
      attempt += 1;
      return attempt === 1
        ? jsonResponse({ error: { message: "rate limited" } }, 429)
        : jsonResponse(okBody);
    }) as typeof fetch;

    const result = await completeReply({
      ...baseInput,
      fetchImpl,
      retryDelayMs: 0,
    });
    expect(attempt).toBe(2);
    expect(result.text).toBe("Здравствуйте! Чем помочь?");
  });

  it("ошибка клиента (400) не ретраится — повтор её не исправит", async () => {
    let attempt = 0;
    const fetchImpl = (async () => {
      attempt += 1;
      return jsonResponse({ error: { message: "bad request" } }, 400);
    }) as typeof fetch;

    await expect(
      completeReply({ ...baseInput, fetchImpl, retryDelayMs: 0 }),
    ).rejects.toBeInstanceOf(LlmError);
    expect(attempt).toBe(1);
  });

  it("исчерпанные ретраи 5xx дают ошибку, а не тишину", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ error: { message: "boom" } }, 503)) as typeof fetch;
    await expect(
      completeReply({
        ...baseInput,
        fetchImpl,
        retryDelayMs: 0,
        maxRetries: 2,
      }),
    ).rejects.toBeInstanceOf(LlmError);
  });

  it("таймаут прерывает зависший вызов", async () => {
    const fetchImpl = ((_url: unknown, init?: unknown) =>
      new Promise((_resolve, reject) => {
        const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
        signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      })) as unknown as typeof fetch;

    await expect(
      completeReply({
        ...baseInput,
        fetchImpl,
        timeoutMs: 20,
        maxRetries: 0,
        retryDelayMs: 0,
      }),
    ).rejects.toBeInstanceOf(LlmError);
  });

  it("ответ без текстового блока — ошибка, а не пустое сообщение клиенту", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ content: [], usage: {} })) as typeof fetch;
    await expect(
      completeReply({ ...baseInput, fetchImpl, maxRetries: 0 }),
    ).rejects.toBeInstanceOf(LlmError);
  });
});
