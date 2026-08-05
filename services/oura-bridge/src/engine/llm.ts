/**
 * Вызов модели для ответа внешнего агента. Прямой HTTP к Anthropic Messages
 * API без SDK — мосту нужен один эндпоинт, а лишняя зависимость тянет свой
 * цикл обновлений.
 *
 * Ключ платформенный и живёт только в окружении сервиса: он не попадает ни в
 * события, ни в логи, ни в текст ошибок.
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const DEFAULT_MAX_TOKENS = 1_024;

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface CompleteReplyInput {
  apiKey: string;
  model: string;
  systemPrompt: string;
  /** предыдущие реплики диалога в хронологическом порядке */
  history: HistoryTurn[];
  userMessage: string;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  /** подменяется в тестах */
  fetchImpl?: typeof fetch;
}

export interface CompleteReplyResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
}

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** 429 и 5xx — временные; 4xx повтор не исправит. */
function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function completeReply(
  input: CompleteReplyInput,
): Promise<CompleteReplyResult> {
  const doFetch = input.fetchImpl ?? fetch;
  const maxRetries = input.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = input.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const body = JSON.stringify({
    model: input.model,
    max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: input.systemPrompt,
    messages: [
      ...input.history.map((turn) => ({
        role: turn.role,
        content: turn.content,
      })),
      { role: "user", content: input.userMessage },
    ],
  });

  let lastError: LlmError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (attempt > 0) await sleep(retryDelayMs * attempt);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": input.apiKey,
          "anthropic-version": API_VERSION,
        },
        body,
        signal: controller.signal,
      });

      if (!res.ok) {
        // тело ответа в сообщение не подставляем: провайдер может вернуть в нём
        // эхо запроса вместе с ключом
        const error = new LlmError(
          `модель ответила ошибкой HTTP ${res.status}`,
          res.status,
        );
        if (!isRetryable(res.status)) throw error;
        lastError = error;
        continue;
      }

      const parsed = (await res.json()) as AnthropicResponse;
      const text = (parsed.content ?? [])
        .filter((block) => block.type === "text" || block.text !== undefined)
        .map((block) => block.text ?? "")
        .join("")
        .trim();
      if (!text) {
        throw new LlmError("модель вернула ответ без текста");
      }
      return {
        text,
        usage: {
          inputTokens: parsed.usage?.input_tokens ?? 0,
          outputTokens: parsed.usage?.output_tokens ?? 0,
        },
      };
    } catch (e) {
      if (e instanceof LlmError) {
        if (e.status !== undefined && !isRetryable(e.status)) throw e;
        if (e.status === undefined) throw e; // ответ без текста — повтор не поможет
        lastError = e;
        continue;
      }
      // сеть, таймаут (AbortError) — временные
      lastError = new LlmError(
        "не удалось получить ответ модели",
        undefined,
        e,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new LlmError("не удалось получить ответ модели");
}
