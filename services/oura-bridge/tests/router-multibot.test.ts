import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Router, sourceLeadKeyPrefix } from "../src/router.js";
import { StateStore } from "../src/state.js";
import type { BuzzApi, OutboundMessage } from "../src/types.js";

/**
 * Мульти-бот: у каждого источника (бота внешнего агента) свой Router с
 * префиксом ключей лидов. Один человек (один telegram chatId) в двух разных
 * ботах — это ДВА разных лида с двумя комнатами; поллеры источников не видят
 * лидов друг друга и лидов легаси-бота (префикс "").
 */

let state: StateStore;
let buzz: {
  createChannel: ReturnType<typeof vi.fn>;
  addMember: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  getMessages: ReturnType<typeof vi.fn>;
  trySetProfile: ReturnType<typeof vi.fn>;
};

function makeRouter(
  prefix: string | undefined,
  delivered: OutboundMessage[],
): Router {
  return new Router({
    buzz: buzz as unknown as BuzzApi,
    state,
    sink: { deliver: async (m) => void delivered.push(m) },
    serviceNsec: "nsec1service",
    servicePubkeyHex: "svc".padEnd(64, "0"),
    operatorPubkeys: [],
    leadKeyPrefix: prefix,
  });
}

beforeEach(async () => {
  state = await StateStore.load(
    join(mkdtempSync(join(tmpdir(), "oura-mb-")), "s.json"),
  );
  let chan = 0;
  buzz = {
    createChannel: vi.fn().mockImplementation(async () => `chan-${++chan}`),
    addMember: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    getMessages: vi.fn().mockResolvedValue([]),
    trySetProfile: vi.fn().mockResolvedValue(undefined),
  };
});

describe("префикс ключей лидов", () => {
  it("sourceLeadKeyPrefix детерминирован и начинается с tg:", () => {
    expect(sourceLeadKeyPrefix("agent-1")).toBe("tg:agent-1:");
  });

  it("один chatId в двух ботах → два лида с разными комнатами", async () => {
    const a = makeRouter(sourceLeadKeyPrefix("agent-a"), []);
    const b = makeRouter(sourceLeadKeyPrefix("agent-b"), []);
    await a.handleInbound({ chatId: "42", name: "Иван", text: "привет A" });
    await b.handleInbound({ chatId: "42", name: "Иван", text: "привет B" });

    const leadA = state.getLead("tg:agent-a:42");
    const leadB = state.getLead("tg:agent-b:42");
    expect(leadA).toBeDefined();
    expect(leadB).toBeDefined();
    expect(leadA?.channelId).not.toBe(leadB?.channelId);
    // в записи хранится сырой chatId для доставки в Telegram
    expect(leadA?.chatId).toBe("42");
  });

  it("легаси-роутер (без префикса) не поллит лидов источников, и наоборот", async () => {
    const legacyDelivered: OutboundMessage[] = [];
    const sourceDelivered: OutboundMessage[] = [];
    const legacy = makeRouter(undefined, legacyDelivered);
    const src = makeRouter(sourceLeadKeyPrefix("agent-a"), sourceDelivered);

    await legacy.handleInbound({ chatId: "1", name: "Пётр", text: "x" });
    await src.handleInbound({ chatId: "2", name: "Анна", text: "y" });

    // оператор ответил в обеих комнатах
    buzz.getMessages.mockResolvedValue([
      {
        id: "m1",
        authorPubkey: "op".padEnd(64, "9"),
        content: "ответ",
        createdAt: 1,
      },
    ]);

    await legacy.pollOutbound();
    expect(legacyDelivered.map((d) => d.chatId)).toEqual(["1"]);

    await src.pollOutbound();
    expect(sourceDelivered.map((d) => d.chatId)).toEqual(["2"]);
  });

  it("legacy-state без префиксов продолжает работать (обратная совместимость)", async () => {
    state.putLead({
      chatId: "7",
      name: "Старый",
      nsec: "nsec1old",
      pubkeyHex: "old".padEnd(64, "0"),
      channelId: "chan-old",
    });
    const delivered: OutboundMessage[] = [];
    const legacy = makeRouter(undefined, delivered);
    buzz.getMessages.mockResolvedValue([
      {
        id: "m2",
        authorPubkey: "op".padEnd(64, "9"),
        content: "здравствуйте",
        createdAt: 2,
      },
    ]);
    await legacy.pollOutbound();
    expect(delivered).toEqual([{ chatId: "7", text: "здравствуйте" }]);
  });
});
