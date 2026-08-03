import type { InboundMessage } from "./types.js";

export type InboundDropReason = "queue_overflow" | "rate_limited";

export interface InboundQueueOptions {
  /** макс. сообщений, ЖДУЩИХ обработки в очереди одного чата (in-flight не считается) */
  maxQueuedPerChat?: number;
  /** макс. принятых сообщений от одного чата за минуту (fixed window) */
  maxPerChatPerMinute?: number;
  /** макс. чатов, обрабатываемых одновременно (каждый — до 5 вызовов buzz-cli) */
  maxConcurrentChats?: number;
  /** инъекция времени для тестов */
  now?: () => number;
  onDrop?: (chatId: string, reason: InboundDropReason) => void;
}

interface ChatQueue {
  items: InboundMessage[];
  running: boolean;
}

const RATE_WINDOW_MS = 60_000;

/**
 * Очередь входящих из внешнего канала перед пайплайном моста.
 *
 * Существует потому, что grammy обрабатывает апдейты последовательно: если
 * хендлер await'ит онбординг (до 5 вызовов buzz-cli × 30s таймаут), одно
 * сообщение любого пользователя блокирует ВЕСЬ мост, а повторами достигается
 * перманентный отказ. Здесь push синхронный, порядок гарантируется только
 * внутри чата, чаты обрабатываются конкурентно, вход ограничен капом очереди
 * и per-chat rate-limit'ом.
 */
export class InboundQueue {
  private readonly chats = new Map<string, ChatQueue>();
  private readonly waitingChats: string[] = [];
  private readonly rate = new Map<
    string,
    { windowStart: number; count: number }
  >();
  private active = 0;
  private idleResolvers: Array<() => void> = [];

  private readonly maxQueuedPerChat: number;
  private readonly maxPerChatPerMinute: number;
  private readonly maxConcurrentChats: number;
  private readonly now: () => number;
  private readonly onDrop: (chatId: string, reason: InboundDropReason) => void;

  constructor(
    private readonly handler: (m: InboundMessage) => Promise<void>,
    opts: InboundQueueOptions = {},
  ) {
    this.maxQueuedPerChat = opts.maxQueuedPerChat ?? 20;
    this.maxPerChatPerMinute = opts.maxPerChatPerMinute ?? 20;
    this.maxConcurrentChats = opts.maxConcurrentChats ?? 8;
    this.now = opts.now ?? Date.now;
    this.onDrop =
      opts.onDrop ??
      ((chatId, reason) =>
        console.warn(
          `[inbound] чат ${chatId}: сообщение дропнуто (${reason})`,
        ));
  }

  /** Синхронно принимает или дропает сообщение; false = дроп (лимит/переполнение). */
  push(m: InboundMessage): boolean {
    if (!this.admitRate(m.chatId)) {
      this.onDrop(m.chatId, "rate_limited");
      return false;
    }
    let q = this.chats.get(m.chatId);
    if (!q) {
      q = { items: [], running: false };
      this.chats.set(m.chatId, q);
    }
    if (q.items.length >= this.maxQueuedPerChat) {
      this.onDrop(m.chatId, "queue_overflow");
      return false;
    }
    q.items.push(m);
    this.schedule(m.chatId);
    return true;
  }

  /** Дождаться полного опустошения (тесты, graceful shutdown). */
  idle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  private admitRate(chatId: string): boolean {
    const now = this.now();
    const r = this.rate.get(chatId);
    if (!r || now - r.windowStart >= RATE_WINDOW_MS) {
      this.rate.set(chatId, { windowStart: now, count: 1 });
      return true;
    }
    if (r.count >= this.maxPerChatPerMinute) return false;
    r.count++;
    return true;
  }

  private schedule(chatId: string): void {
    const q = this.chats.get(chatId);
    if (!q || q.running || q.items.length === 0) return;
    if (this.active >= this.maxConcurrentChats) {
      if (!this.waitingChats.includes(chatId)) this.waitingChats.push(chatId);
      return;
    }
    q.running = true;
    this.active++;
    void this.drain(chatId, q);
  }

  private async drain(chatId: string, q: ChatQueue): Promise<void> {
    while (q.items.length > 0) {
      const m = q.items.shift();
      if (!m) break;
      try {
        await this.handler(m);
      } catch (e) {
        console.error(`[inbound] чат ${chatId}: ошибка обработки:`, e);
      }
    }
    q.running = false;
    this.active--;
    if (q.items.length === 0) this.chats.delete(chatId);
    const next = this.waitingChats.shift();
    if (next) this.schedule(next);
    if (this.isIdle()) {
      const resolvers = this.idleResolvers;
      this.idleResolvers = [];
      for (const resolve of resolvers) resolve();
    }
  }

  private isIdle(): boolean {
    return this.active === 0 && this.chats.size === 0;
  }
}
