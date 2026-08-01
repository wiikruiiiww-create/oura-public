import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "../src/router.js";
import { StateStore } from "../src/state.js";
import type { BuzzApi, OutboundMessage } from "../src/types.js";
import { PermanentDeliveryError } from "../src/types.js";

let state: StateStore;
let buzz: {
  createChannel: ReturnType<typeof vi.fn>;
  addMember: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  getMessages: ReturnType<typeof vi.fn>;
  trySetProfile: ReturnType<typeof vi.fn>;
};
let delivered: OutboundMessage[];

function makeRouter(operatorPubkeys: string[] = []): Router {
  return new Router({
    buzz: buzz as unknown as BuzzApi,
    state,
    sink: { deliver: async (m) => void delivered.push(m) },
    serviceNsec: "nsec1service",
    servicePubkeyHex: "svc".padEnd(64, "0"),
    operatorPubkeys,
  });
}

beforeEach(async () => {
  state = await StateStore.load(
    join(mkdtempSync(join(tmpdir(), "oura-router-")), "s.json"),
  );
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
    await makeRouter(["op".padEnd(64, "1")]).handleInbound({
      chatId: "42",
      name: "Иван",
      text: "Здравствуйте!",
    });
    expect(buzz.createChannel).toHaveBeenCalledWith(
      "nsec1service",
      expect.stringContaining("42"),
    );
    const lead = state.getLead("42");
    expect(lead).toBeDefined();
    expect(lead?.channelId).toBe("chan-new");
    // участники: лид и оператор
    expect(buzz.addMember).toHaveBeenCalledWith(
      "nsec1service",
      "chan-new",
      lead?.pubkeyHex,
    );
    expect(buzz.addMember).toHaveBeenCalledWith(
      "nsec1service",
      "chan-new",
      "op".padEnd(64, "1"),
    );
    // сообщение ушло от имени лида
    expect(buzz.sendMessage).toHaveBeenCalledWith(
      lead?.nsec,
      "chan-new",
      "Здравствуйте!",
    );
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
      {
        id: "e1",
        authorPubkey: lead?.pubkeyHex,
        content: "вопрос",
        createdAt: 1,
      },
      {
        id: "e2",
        authorPubkey: "svc".padEnd(64, "0"),
        content: "служебное",
        createdAt: 2,
      },
      {
        id: "e3",
        authorPubkey: "operator-pk",
        content: "Добрый день!",
        createdAt: 3,
      },
    ]);
    await r.pollOutbound();
    await r.pollOutbound(); // повторный поллинг не должен дублировать
    expect(delivered).toEqual([{ chatId: "42", text: "Добрый день!" }]);
  });
});

describe("устойчивость", () => {
  it("два конкурентных первых сообщения одного чата не создают два канала", async () => {
    const r = makeRouter();
    let resolveCreate!: (v: string) => void;
    buzz.createChannel.mockImplementation(
      () =>
        new Promise((res) => {
          resolveCreate = res;
        }),
    );
    const p1 = r.handleInbound({ chatId: "42", name: "Иван", text: "раз" });
    const p2 = r.handleInbound({ chatId: "42", name: "Иван", text: "два" });
    resolveCreate("chan-new");
    await Promise.all([p1, p2]);
    expect(buzz.createChannel).toHaveBeenCalledTimes(1);
    expect(buzz.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("сбой доставки не помечает сообщение просмотренным — повторный поллинг доставляет", async () => {
    let fail = true;
    const r = new Router({
      buzz: buzz as unknown as BuzzApi,
      state,
      sink: {
        deliver: async (m) => {
          if (fail) throw new Error("tg down");
          delivered.push(m);
        },
      },
      serviceNsec: "nsec1service",
      servicePubkeyHex: "svc".padEnd(64, "0"),
      operatorPubkeys: [],
    });
    await r.handleInbound({ chatId: "42", name: "Иван", text: "вопрос" });
    buzz.getMessages.mockResolvedValue([
      {
        id: "e3",
        authorPubkey: "operator-pk",
        content: "Добрый день!",
        createdAt: 3,
      },
    ]);
    await r.pollOutbound();
    expect(delivered).toEqual([]);
    fail = false;
    await r.pollOutbound();
    expect(delivered).toEqual([{ chatId: "42", text: "Добрый день!" }]);
  });

  it("санитизация имени канала: спецсимволы → дефисы, пустое имя → lead", async () => {
    const r = makeRouter();
    await r.handleInbound({ chatId: "1", name: "Иван Петров!!!", text: "а" });
    expect(buzz.createChannel).toHaveBeenLastCalledWith(
      "nsec1service",
      "inbox-иван-петров-1",
    );
    await r.handleInbound({ chatId: "2", name: "@@@", text: "б" });
    expect(buzz.createChannel).toHaveBeenLastCalledWith(
      "nsec1service",
      "inbox-lead-2",
    );
  });

  it("PermanentDeliveryError: сообщение помечается seen и не долбится повторно", async () => {
    const r = makeRouter();
    await r.handleInbound({ chatId: "42", name: "Иван", text: "вопрос" });
    const lead = state.getLead("42");
    if (!lead) throw new Error("lead not found");
    const deliveryAttempts: string[] = [];
    const r2 = new Router({
      buzz: buzz as unknown as BuzzApi,
      state,
      sink: {
        deliver: async (_m) => {
          deliveryAttempts.push("try");
          throw new PermanentDeliveryError("бот заблокирован");
        },
      },
      serviceNsec: "nsec1service",
      servicePubkeyHex: "svc".padEnd(64, "0"),
      operatorPubkeys: [],
    });
    buzz.getMessages.mockResolvedValue([
      {
        id: "e3",
        authorPubkey: "operator-pk",
        content: "Добрый день!",
        createdAt: 3,
      },
    ]);
    await r2.pollOutbound();
    await r2.pollOutbound(); // второй поллинг
    expect(deliveryAttempts.length).toBe(1); // повторной попытки не было
    expect(state.hasSeen(lead.chatId, "e3")).toBe(true); // сообщение помечено seen
  });

  it("временная ошибка доставки: сообщение НЕ помечается seen, попытка повторяется", async () => {
    const r = makeRouter();
    await r.handleInbound({ chatId: "42", name: "Иван", text: "вопрос" });
    const lead = state.getLead("42");
    if (!lead) throw new Error("lead not found");
    let fail = true;
    const r2 = new Router({
      buzz: buzz as unknown as BuzzApi,
      state,
      sink: {
        deliver: async (m) => {
          if (fail) {
            throw new Error("tg down");
          }
          delivered.push(m);
        },
      },
      serviceNsec: "nsec1service",
      servicePubkeyHex: "svc".padEnd(64, "0"),
      operatorPubkeys: [],
    });
    buzz.getMessages.mockResolvedValue([
      {
        id: "e3",
        authorPubkey: "operator-pk",
        content: "Добрый день!",
        createdAt: 3,
      },
    ]);
    // первый поллинг: ошибка
    await r2.pollOutbound();
    expect(delivered.length).toBe(0); // ничего не доставлено
    expect(state.hasSeen(lead.chatId, "e3")).toBe(false); // сообщение НЕ помечено seen
    // второй поллинг: успех
    fail = false;
    await r2.pollOutbound();
    expect(delivered.length).toBe(1); // доставлено
    expect(state.hasSeen(lead.chatId, "e3")).toBe(true); // теперь помечено seen
  });

  it("seen-пометки, сделанные до сбоя в пачке, сохраняются даже если следующее сообщение бросило временную ошибку", async () => {
    const r = makeRouter();
    await r.handleInbound({ chatId: "42", name: "Иван", text: "вопрос" });
    const lead = state.getLead("42");
    if (!lead) throw new Error("lead not found");
    const saveSpy = vi.spyOn(state, "save");
    let attempt = 0;
    const r2 = new Router({
      buzz: buzz as unknown as BuzzApi,
      state,
      sink: {
        deliver: async (_m) => {
          attempt += 1;
          if (attempt === 1) {
            // первое сообщение пачки: перманентный сбой — помечается seen сразу
            throw new PermanentDeliveryError("бот заблокирован");
          }
          // второе сообщение той же пачки: временная ошибка обрывает обработку лида
          throw new Error("tg down");
        },
      },
      serviceNsec: "nsec1service",
      servicePubkeyHex: "svc".padEnd(64, "0"),
      operatorPubkeys: [],
    });
    buzz.getMessages.mockResolvedValue([
      {
        id: "e-perm",
        authorPubkey: "operator-pk",
        content: "первое сообщение",
        createdAt: 1,
      },
      {
        id: "e-temp",
        authorPubkey: "operator-pk",
        content: "второе сообщение",
        createdAt: 2,
      },
    ]);
    await r2.pollOutbound();
    // прогресс по первому сообщению не должен теряться из-за сбоя на втором
    expect(state.hasSeen(lead.chatId, "e-perm")).toBe(true);
    expect(state.hasSeen(lead.chatId, "e-temp")).toBe(false);
    expect(saveSpy).toHaveBeenCalled();
  });
});

describe("allow-list операторов (I5)", () => {
  it("при заданном allow-list сообщение чужого участника НЕ доставляется, но помечается seen", async () => {
    const r = new Router({
      buzz: buzz as unknown as BuzzApi,
      state,
      sink: { deliver: async (m) => void delivered.push(m) },
      serviceNsec: "nsec1service",
      servicePubkeyHex: "svc".padEnd(64, "0"),
      operatorPubkeys: ["operator-pk"],
    });
    await r.handleInbound({ chatId: "42", name: "Иван", text: "вопрос" });
    const lead = state.getLead("42");
    if (!lead) throw new Error("lead not found");
    buzz.getMessages.mockResolvedValue([
      {
        id: "e-stranger",
        authorPubkey: "stranger-pk",
        content: "чужое сообщение",
        createdAt: 1,
      },
    ]);
    await r.pollOutbound();
    expect(delivered.length).toBe(0);
    expect(state.hasSeen(lead.chatId, "e-stranger")).toBe(true);
  });

  it("сообщение оператора из allow-list доставляется", async () => {
    const r = new Router({
      buzz: buzz as unknown as BuzzApi,
      state,
      sink: { deliver: async (m) => void delivered.push(m) },
      serviceNsec: "nsec1service",
      servicePubkeyHex: "svc".padEnd(64, "0"),
      operatorPubkeys: ["operator-pk"],
    });
    await r.handleInbound({ chatId: "42", name: "Иван", text: "вопрос" });
    buzz.getMessages.mockResolvedValue([
      {
        id: "e-op",
        authorPubkey: "operator-pk",
        content: "Добрый день!",
        createdAt: 1,
      },
    ]);
    await r.pollOutbound();
    expect(delivered).toEqual([{ chatId: "42", text: "Добрый день!" }]);
  });

  it("пустой allow-list: любой не-лид/не-сервис доставляется (поведение Фазы 0)", async () => {
    const r = makeRouter([]);
    await r.handleInbound({ chatId: "42", name: "Иван", text: "вопрос" });
    buzz.getMessages.mockResolvedValue([
      {
        id: "e-anyone",
        authorPubkey: "anyone-pk",
        content: "любой участник",
        createdAt: 1,
      },
    ]);
    await r.pollOutbound();
    expect(delivered.length).toBe(1);
  });

  it("все операторы из списка добавляются участниками при онбординге лида", async () => {
    const r = makeRouter(["op-1", "op-2"]);
    await r.handleInbound({ chatId: "42", name: "Иван", text: "вопрос" });
    const addedMembers = buzz.addMember.mock.calls.map(
      (call) => call[2] as string,
    );
    expect(addedMembers).toEqual(expect.arrayContaining(["op-1", "op-2"]));
  });
});
