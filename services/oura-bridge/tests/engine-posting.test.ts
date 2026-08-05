import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureAgentIdentity } from "../src/engine/identity.js";
import type { EngineLead } from "../src/engine/pipeline.js";
import {
  DRAFT_HINT,
  ensureAgentInRoom,
  postDraft,
  type PostingDeps,
} from "../src/engine/posting.js";
import { StateStore } from "../src/state.js";

const LEAD: EngineLead = {
  key: "tg:agent-1:42",
  pubkeyHex: "1ead".padEnd(64, "0"),
  channelId: "chan-1",
};

let state: StateStore;
let buzz: {
  addMember: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  trySetProfile: ReturnType<typeof vi.fn>;
};

async function agent() {
  const id = await ensureAgentIdentity(state, "agent-1");
  return { agentId: "agent-1", name: "Аня", ...id };
}

function deps(overrides: Partial<PostingDeps> = {}): PostingDeps {
  return {
    buzz: buzz as unknown as PostingDeps["buzz"],
    state,
    serviceNsec: "nsec1service",
    now: () => 1_000_000,
    ...overrides,
  };
}

beforeEach(async () => {
  state = await StateStore.load(
    join(mkdtempSync(join(tmpdir(), "oura-posting-")), "s.json"),
  );
  buzz = {
    addMember: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue("evt-1"),
    trySetProfile: vi.fn().mockResolvedValue(undefined),
  };
});

describe("ключ агента", () => {
  it("минтится один раз и переживает перезапуск", async () => {
    const first = await ensureAgentIdentity(state, "agent-1");
    const second = await ensureAgentIdentity(state, "agent-1");
    expect(second).toEqual(first);
    expect(state.getAgentKey("agent-1")?.pubkeyHex).toBe(first.pubkeyHex);
  });

  it("у разных агентов разные ключи", async () => {
    const a = await ensureAgentIdentity(state, "agent-1");
    const b = await ensureAgentIdentity(state, "agent-2");
    expect(a.pubkeyHex).not.toBe(b.pubkeyHex);
  });
});

describe("вход агента в комнату", () => {
  it("добавляется участником и получает имя", async () => {
    const a = await agent();
    await ensureAgentInRoom(deps(), a, LEAD);
    expect(buzz.addMember).toHaveBeenCalledWith(
      "nsec1service",
      "chan-1",
      a.pubkeyHex,
    );
    expect(buzz.trySetProfile).toHaveBeenCalledWith(a.nsec, "Аня");
  });

  it("повторный вызов relay не дёргает", async () => {
    const a = await agent();
    await ensureAgentInRoom(deps(), a, LEAD);
    await ensureAgentInRoom(deps(), a, LEAD);
    expect(buzz.addMember).toHaveBeenCalledTimes(1);
  });

  it("ключ агента регистрируется участником relay до добавления в комнату", async () => {
    const order: string[] = [];
    const registerMember = vi.fn(async () => void order.push("register"));
    buzz.addMember.mockImplementation(async () => void order.push("add"));
    const a = await agent();
    await ensureAgentInRoom(deps({ registerMember }), a, LEAD);
    expect(registerMember).toHaveBeenCalledWith(a.pubkeyHex);
    expect(order).toEqual(["register", "add"]);
  });

  it("сбой добавления не помечает агента вошедшим", async () => {
    buzz.addMember.mockRejectedValueOnce(new Error("relay недоступен"));
    const a = await agent();
    await expect(ensureAgentInRoom(deps(), a, LEAD)).rejects.toThrow();
    expect(state.getAgentLead(LEAD.key)?.agentInRoom).not.toBe(true);
  });
});

describe("черновик ответа", () => {
  it("уходит в комнату под ключом агента с подсказкой оператору", async () => {
    const a = await agent();
    await postDraft(deps(), a, LEAD, "Здравствуйте! Подскажу по ценам.");
    expect(buzz.sendMessage).toHaveBeenCalledWith(
      a.nsec,
      "chan-1",
      `${DRAFT_HINT}\n\nЗдравствуйте! Подскажу по ценам.`,
    );
  });

  it("запоминается с чистым текстом — клиент подсказку не увидит", async () => {
    const a = await agent();
    const draft = await postDraft(deps(), a, LEAD, "Работаем с 9 до 18.");
    expect(draft).toEqual({
      eventId: "evt-1",
      text: "Работаем с 9 до 18.",
      createdAtMs: 1_000_000,
    });
    expect(state.getAgentLead(LEAD.key)?.pendingDrafts).toEqual([draft]);
  });

  it("новый черновик отменяет предыдущий — одобрить устаревший ответ нельзя", async () => {
    const a = await agent();
    buzz.sendMessage
      .mockResolvedValueOnce("evt-1")
      .mockResolvedValueOnce("evt-2");
    await postDraft(deps(), a, LEAD, "первый");
    await postDraft(deps(), a, LEAD, "второй");
    const record = state.getAgentLead(LEAD.key);
    expect(record?.pendingDrafts?.map((d) => d.eventId)).toEqual(["evt-2"]);
    expect(record?.undeliveredDraftEventIds).toEqual(["evt-1"]);
  });

  it("без id события черновик не сохраняется — одобрить его было бы нечем", async () => {
    buzz.sendMessage.mockResolvedValueOnce(null);
    const a = await agent();
    await expect(postDraft(deps(), a, LEAD, "текст")).rejects.toThrow(
      /id события/i,
    );
    expect(state.getAgentLead(LEAD.key)?.pendingDrafts ?? []).toHaveLength(0);
  });
});
