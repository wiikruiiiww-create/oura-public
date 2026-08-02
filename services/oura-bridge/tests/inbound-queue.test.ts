import { describe, expect, it } from "vitest";
import { InboundQueue } from "../src/inbound-queue.js";
import type { InboundMessage } from "../src/types.js";

function msg(chatId: string, text: string): InboundMessage {
  return { chatId, name: `Лид ${chatId}`, text };
}

/** Промис с ручным resolve — для «зависшего» обработчика. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("InboundQueue", () => {
  it("push возвращается синхронно, не дожидаясь обработчика", async () => {
    const g = gate();
    const q = new InboundQueue(() => g.promise);
    const accepted = q.push(msg("1", "привет"));
    expect(accepted).toBe(true); // если бы push ждал обработчик, сюда бы не дошли
    g.open();
    await q.idle();
  });

  it("порядок сообщений внутри одного чата сохраняется", async () => {
    const seen: string[] = [];
    const q = new InboundQueue(async (m) => {
      // произвольная асинхронность внутри обработчика не должна ломать порядок
      await tick();
      seen.push(m.text);
    });
    q.push(msg("1", "a"));
    q.push(msg("1", "b"));
    q.push(msg("1", "c"));
    await q.idle();
    expect(seen).toEqual(["a", "b", "c"]);
  });

  it("зависший чат не блокирует обработку другого чата", async () => {
    const g = gate();
    const seen: string[] = [];
    const q = new InboundQueue(async (m) => {
      if (m.chatId === "залипший") await g.promise;
      seen.push(m.text);
    });
    q.push(msg("залипший", "висит"));
    q.push(msg("живой", "проходит"));
    await tick();
    expect(seen).toEqual(["проходит"]);
    g.open();
    await q.idle();
    expect(seen).toContain("висит");
  });

  it("переполнение очереди чата дропается с причиной queue_overflow", async () => {
    const g = gate();
    const drops: Array<{ chatId: string; reason: string }> = [];
    const q = new InboundQueue(() => g.promise, {
      maxQueuedPerChat: 2,
      onDrop: (chatId, reason) => drops.push({ chatId, reason }),
    });
    expect(q.push(msg("1", "в работе"))).toBe(true);
    await tick(); // первое сообщение ушло в обработчик и повисло
    expect(q.push(msg("1", "в очереди 1"))).toBe(true);
    expect(q.push(msg("1", "в очереди 2"))).toBe(true);
    expect(q.push(msg("1", "лишнее"))).toBe(false);
    expect(drops).toEqual([{ chatId: "1", reason: "queue_overflow" }]);
    g.open();
    await q.idle();
  });

  it("rate limit: свыше N сообщений в минуту от чата дропаются, окно сбрасывается", async () => {
    let nowMs = 1_000_000;
    const drops: string[] = [];
    const q = new InboundQueue(async () => {}, {
      maxPerChatPerMinute: 3,
      now: () => nowMs,
      onDrop: (_chatId, reason) => drops.push(reason),
    });
    expect(q.push(msg("1", "a"))).toBe(true);
    expect(q.push(msg("1", "b"))).toBe(true);
    expect(q.push(msg("1", "c"))).toBe(true);
    expect(q.push(msg("1", "лишнее"))).toBe(false);
    expect(drops).toEqual(["rate_limited"]);
    // другой чат лимитом первого не задет
    expect(q.push(msg("2", "сосед"))).toBe(true);
    // спустя минуту окно чата 1 открывается заново
    nowMs += 61_000;
    expect(q.push(msg("1", "после паузы"))).toBe(true);
    await q.idle();
  });

  it("ошибка обработчика не останавливает очередь чата", async () => {
    const seen: string[] = [];
    const q = new InboundQueue(async (m) => {
      if (m.text === "взрыв") throw new Error("обработчик упал");
      seen.push(m.text);
    });
    q.push(msg("1", "взрыв"));
    q.push(msg("1", "после взрыва"));
    await q.idle();
    expect(seen).toEqual(["после взрыва"]);
  });

  it("глобальный параллелизм ограничен maxConcurrentChats", async () => {
    const g = gate();
    const started: string[] = [];
    const q = new InboundQueue(
      async (m) => {
        started.push(m.chatId);
        await g.promise;
      },
      { maxConcurrentChats: 1 },
    );
    q.push(msg("1", "a"));
    q.push(msg("2", "b"));
    await tick();
    expect(started).toEqual(["1"]); // чат 2 ждёт глобальный слот
    g.open();
    await q.idle();
    expect(started).toEqual(["1", "2"]);
  });

  it("idle резолвится сразу, когда очередь пуста", async () => {
    const q = new InboundQueue(async () => {});
    await q.idle();
  });
});
