import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RESUME_COMMAND } from "../src/engine/handoff.js";
import type { CompleteCall } from "../src/engine/pipeline.js";
import { DRAFT_HINT } from "../src/engine/posting.js";
import {
  AgentRuntime,
  type RuntimeAgent,
  type RuntimeDeps,
} from "../src/engine/runtime.js";
import { StateStore } from "../src/state.js";
import type { BuzzMessage, OutboundMessage } from "../src/types.js";

const SERVICE_PK = "5e12".padEnd(64, "0");
const OPERATOR_PK = "0f11".padEnd(64, "0");

const AGENT: RuntimeAgent = {
  agentId: "agent-1",
  name: "Аня",
  isActive: true,
  profile: {
    goal: "записать на консультацию",
    role: "sales",
    tone: {
      formality: "friendly",
      maxEmojis: 1,
      maxLength: "short",
      language: "русский",
    },
    audience: "",
    instructions: "",
    knowledge: "",
  },
};

let state: StateStore;
let delivered: OutboundMessage[];
let sent: Array<{ nsec: string; channelId: string; content: string }>;
let roomMessages: BuzzMessage[];
let replyText: string;
let complete: ReturnType<typeof vi.fn>;
let nextEventId: number;

function makeDeps(overrides: Partial<RuntimeDeps> = {}): RuntimeDeps {
  return {
    buzz: {
      addMember: async () => {},
      trySetProfile: async () => {},
      getMessages: async () => roomMessages,
      sendMessage: async (nsec, channelId, content) => {
        sent.push({ nsec, channelId, content });
        const id = `evt-${nextEventId++}`;
        roomMessages.push({
          id,
          authorPubkey: state.getAgentKey("agent-1")?.pubkeyHex ?? "",
          content,
          createdAt: 100 + nextEventId,
        });
        return id;
      },
    },
    state,
    sink: { deliver: async (m) => void delivered.push(m) },
    relayUrl: "http://relay.test",
    serviceNsec:
      "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5",
    servicePubkeyHex: SERVICE_PK,
    operatorPubkeys: [OPERATOR_PK],
    complete: complete as unknown as RuntimeDeps["complete"],
    fetchImpl: (async () =>
      new Response("[]", { status: 200 })) as unknown as typeof fetch,
    now: () => 1_000_000,
    ...overrides,
  };
}

async function seedLead(chatId = "42") {
  const key = `tg:agent-1:${chatId}`;
  state.putLead(
    {
      chatId,
      name: "Иван",
      nsec: "nsec1lead",
      pubkeyHex: "1ead".padEnd(64, "0"),
      channelId: "chan-1",
      lastActivityAt: 1_000_000,
    },
    key,
  );
  await state.save();
  return key;
}

beforeEach(async () => {
  state = await StateStore.load(
    join(mkdtempSync(join(tmpdir(), "oura-runtime-")), "s.json"),
  );
  delivered = [];
  sent = [];
  nextEventId = 1;
  replyText = "Здравствуйте! Подскажу. [STATUS:in_progress]";
  roomMessages = [
    {
      id: "m1",
      authorPubkey: "1ead".padEnd(64, "0"),
      content: "Сколько стоит?",
      createdAt: 10,
    },
  ];
  complete = vi.fn(async (_c: CompleteCall) => ({
    text: replyText,
    usage: { inputTokens: 10, outputTokens: 5 },
  }));
});

describe("режим черновиков", () => {
  it("ответ появляется в комнате, но клиенту не уходит", async () => {
    await seedLead();
    await new AgentRuntime(makeDeps()).tick(AGENT);
    expect(sent).toHaveLength(1);
    expect(sent[0].content.startsWith(DRAFT_HINT)).toBe(true);
    expect(delivered).toEqual([]);
  });

  it("после одобрения текст уходит клиенту без служебной обёртки", async () => {
    const key = await seedLead();
    const deps = makeDeps();
    await new AgentRuntime(deps).tick(AGENT);
    const draftId = state.getAgentLead(key)?.pendingDrafts?.[0]?.eventId;
    const approving = (async () =>
      new Response(
        JSON.stringify([
          {
            pubkey: OPERATOR_PK,
            kind: 7,
            content: "👍",
            tags: [["e", draftId]],
          },
        ]),
        { status: 200 },
      )) as unknown as typeof fetch;
    roomMessages = roomMessages.filter((m) => m.id !== "m1");
    await new AgentRuntime(makeDeps({ fetchImpl: approving })).tick(AGENT);
    expect(delivered).toEqual([
      { chatId: "42", text: "Здравствуйте! Подскажу." },
    ]);
  });
});

describe("режим без одобрения", () => {
  it("ответ уходит клиенту сразу и без подсказки в комнате", async () => {
    await seedLead();
    await new AgentRuntime(makeDeps({ autoReply: true })).tick(AGENT);
    expect(sent[0].content).toBe("Здравствуйте! Подскажу.");
    expect(delivered).toEqual([
      { chatId: "42", text: "Здравствуйте! Подскажу." },
    ]);
  });
});

describe("передача человеку", () => {
  it("после просьбы клиента агент замолкает и команда получает уведомление", async () => {
    const key = await seedLead();
    replyText = "Секунду, зову коллегу. [NEED_HUMAN]";
    const deps = makeDeps();
    await new AgentRuntime(deps).tick(AGENT);
    expect(state.getAgentLead(key)?.silenced).toBe(true);
    const notice = sent.find((s) => s.content.includes(RESUME_COMMAND));
    expect(notice).toBeDefined();
    expect(notice?.nsec).toBe(deps.serviceNsec);

    // следующее сообщение клиента агент уже не обрабатывает
    roomMessages.push({
      id: "m2",
      authorPubkey: "1ead".padEnd(64, "0"),
      content: "Ещё вопрос",
      createdAt: 200,
    });
    complete.mockClear();
    await new AgentRuntime(makeDeps()).tick(AGENT);
    expect(complete).not.toHaveBeenCalled();
  });

  it("команда возвращает агента в диалог", async () => {
    const key = await seedLead();
    replyText = "Секунду. [NEED_HUMAN]";
    await new AgentRuntime(makeDeps()).tick(AGENT);
    roomMessages.push({
      id: "cmd",
      authorPubkey: OPERATOR_PK,
      content: RESUME_COMMAND,
      createdAt: 300,
    });
    await new AgentRuntime(makeDeps()).tick(AGENT);
    expect(state.getAgentLead(key)?.silenced).toBe(false);
  });
});

describe("границы движка", () => {
  it("чужие лиды агент не трогает", async () => {
    state.putLead(
      {
        chatId: "99",
        name: "Чужой",
        nsec: "nsec1other",
        pubkeyHex: "beef".padEnd(64, "0"),
        channelId: "chan-other",
        lastActivityAt: 1_000_000,
      },
      "tg:agent-2:99",
    );
    // легаси-лид без источника — тоже не наш
    state.putLead(
      {
        chatId: "7",
        name: "Легаси",
        nsec: "nsec1legacy",
        pubkeyHex: "cafe".padEnd(64, "0"),
        channelId: "chan-legacy",
        lastActivityAt: 1_000_000,
      },
      "7",
    );
    await state.save();
    await new AgentRuntime(makeDeps()).tick(AGENT);
    expect(complete).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("выключенный агент не работает вовсе", async () => {
    await seedLead();
    await new AgentRuntime(makeDeps()).tick({ ...AGENT, isActive: false });
    expect(complete).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("сбой на одном лиде не останавливает остальных", async () => {
    await seedLead("42");
    await seedLead("43");
    complete.mockRejectedValueOnce(new Error("модель недоступна"));
    await new AgentRuntime(makeDeps()).tick(AGENT);
    expect(sent).toHaveLength(1);
  });
});
