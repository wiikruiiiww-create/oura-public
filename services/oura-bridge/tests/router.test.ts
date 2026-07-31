import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "../src/router.js";
import { StateStore } from "../src/state.js";
import type { BuzzApi, OutboundMessage } from "../src/types.js";

let state: StateStore;
let buzz: {
  createChannel: ReturnType<typeof vi.fn>;
  addMember: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  getMessages: ReturnType<typeof vi.fn>;
  trySetProfile: ReturnType<typeof vi.fn>;
};
let delivered: OutboundMessage[];

function makeRouter(operatorPubkeyHex?: string): Router {
  return new Router({
    buzz: buzz as unknown as BuzzApi,
    state,
    sink: { deliver: async (m) => void delivered.push(m) },
    serviceNsec: "nsec1service",
    servicePubkeyHex: "svc".padEnd(64, "0"),
    operatorPubkeyHex,
  });
}

beforeEach(async () => {
  state = await StateStore.load(join(mkdtempSync(join(tmpdir(), "oura-router-")), "s.json"));
  delivered = [];
  buzz = {
    createChannel: vi.fn().mockResolvedValue("chan-new"),
    addMember: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    getMessages: vi.fn().mockResolvedValue([]),
    trySetProfile: vi.fn().mockResolvedValue(undefined),
  };
});

describe("handleInbound", () => {
  it("первое сообщение: минтит лида, создаёт канал, добавляет участников, шлёт от имени лида", async () => {
    await makeRouter("op".padEnd(64, "1")).handleInbound({ chatId: "42", name: "Иван", text: "Здравствуйте!" });
    expect(buzz.createChannel).toHaveBeenCalledWith("nsec1service", expect.stringContaining("42"));
    const lead = state.getLead("42");
    expect(lead).toBeDefined();
    expect(lead?.channelId).toBe("chan-new");
    // участники: лид и оператор
    expect(buzz.addMember).toHaveBeenCalledWith("nsec1service", "chan-new", lead?.pubkeyHex);
    expect(buzz.addMember).toHaveBeenCalledWith("nsec1service", "chan-new", "op".padEnd(64, "1"));
    // сообщение ушло от имени лида
    expect(buzz.sendMessage).toHaveBeenCalledWith(lead?.nsec, "chan-new", "Здравствуйте!");
  });

  it("повторное сообщение того же чата не создаёт второй канал", async () => {
    const r = makeRouter();
    await r.handleInbound({ chatId: "42", name: "Иван", text: "раз" });
    await r.handleInbound({ chatId: "42", name: "Иван", text: "два" });
    expect(buzz.createChannel).toHaveBeenCalledTimes(1);
    expect(buzz.sendMessage).toHaveBeenCalledTimes(2);
  });
});

describe("pollOutbound", () => {
  it("доставляет только чужие непросмотренные сообщения, без дублей", async () => {
    const r = makeRouter();
    await r.handleInbound({ chatId: "42", name: "Иван", text: "вопрос" });
    const lead = state.getLead("42");
    buzz.getMessages.mockResolvedValue([
      { id: "e1", authorPubkey: lead?.pubkeyHex, content: "вопрос", createdAt: 1 },
      { id: "e2", authorPubkey: "svc".padEnd(64, "0"), content: "служебное", createdAt: 2 },
      { id: "e3", authorPubkey: "operator-pk", content: "Добрый день!", createdAt: 3 },
    ]);
    await r.pollOutbound();
    await r.pollOutbound(); // повторный поллинг не должен дублировать
    expect(delivered).toEqual([{ chatId: "42", text: "Добрый день!" }]);
  });
});
