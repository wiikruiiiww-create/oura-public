import { GrammyError, HttpError } from "grammy";
import type { InboundMessage } from "../types.js";

/** Минимальная форма текстового сообщения Telegram (подмножество grammy Message). */
export interface TgTextMessage {
  chat: { id: number };
  from?: { first_name?: string };
  text: string;
}

/**
 * Маппинг полей: externalId = String(chat.id),
 * имя = from.first_name (last_name/username не используются).
 */
export function toInbound(msg: TgTextMessage): InboundMessage {
  return {
    chatId: String(msg.chat.id),
    name: msg.from?.first_name?.trim() || "Клиент",
    text: msg.text,
  };
}

/** Лимит Telegram на sendMessage — 4096 символов; текст длиннее уходит несколькими сообщениями. */
export function chunkText(text: string, max = 4096): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.5) cut = max;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^[\n ]+/, "");
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

/** Классификация ошибок: сеть и 408/429/5xx — ретраем, прочие 4xx — нет. */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) return true;
  if (err instanceof GrammyError) return RETRYABLE_STATUS.has(err.error_code);
  return false;
}

/** 403 всегда значит «бот заблокирован/удалён из чата» — перечислен целиком. */
const PERMANENT_STATUS = new Set([403]);

/**
 * 400 перманентен только для конкретных, узнаваемых причин — не целиком:
 * чат/пользователь физически не существуют. Любое другое описание 400
 * остаётся временным.
 */
const PERMANENT_400_DESCRIPTION =
  /chat not found|user is deactivated|bot was blocked|PEER_ID_INVALID/i;

/**
 * Перманентная недоставляемость конкретному чату (бот заблокирован, чат
 * удалён). В отличие от `isRetryable`, дефолт здесь — «временная»: 401
 * (отозванный/неверный токен — поломка конфигурации, не чата), прочие 400,
 * HttpError и любые нераспознанные ошибки классифицируются как временные,
 * чтобы поллер их повторил, а не терял сообщение навсегда.
 */
export function isPermanentDeliveryFailure(err: unknown): boolean {
  if (!(err instanceof GrammyError)) return false;
  if (PERMANENT_STATUS.has(err.error_code)) return true;
  return (
    err.error_code === 400 && PERMANENT_400_DESCRIPTION.test(err.description)
  );
}

export interface RetryOpts {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** инъекция для тестов */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Экспоненциальный backoff с джиттером (3 попытки, 500→5000ms),
 * плюс: 429 c parameters.retry_after ждёт ровно указанное Telegram время (cap 30с).
 */
export async function sendWithRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOpts = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 5000;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isRetryable(e) || attempt === maxAttempts) throw e;
      const retryAfterSec =
        e instanceof GrammyError ? e.parameters?.retry_after : undefined;
      const backoff =
        Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)) *
        (0.5 + Math.random() * 0.5);
      await sleep(
        retryAfterSec !== undefined
          ? Math.min(retryAfterSec * 1000, 30_000)
          : backoff,
      );
    }
  }
  throw lastErr;
}
