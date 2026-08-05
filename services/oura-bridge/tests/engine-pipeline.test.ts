import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CompleteCall,
  EngineAgent,
  EngineLead,
} from "../src/engine/pipeline.js";
import { AgentPipeline } from "../src/engine/pipeline.js";
import type { AgentProfile } from "../src/engine/prompt.js";
import { StateStore } from "../src/state.js";
import type { BuzzMessage } from "../src/types.js";

const LEAD_PK = "1ead".padEnd(64, "0");
const AGENT_PK = "a9e7".padEnd(64, "0");
const SERVICE_PK = "5e12".padEnd(64, "0");
const OPERATOR_PK = "0f11".padEnd(64, "0");

const PROFILE: AgentProfile = {
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
};

const AGENT: EngineAgent = {
  agentId: "agent-1",
  name: "Аня",
  pubkeyHex: AGENT_PK,
  profile: PROFILE,
};

const LEAD: EngineLead = {
  key: "tg:agent-1:42",
  pubkeyHex: LEAD_PK,
  channelId: "chan-1",
};

let state: StateStore;
let messages: BuzzMessage[];
let complete: ReturnType<typeof vi.fn>;
let calls: CompleteCall[];

function msg(
  id: string,
  authorPubkey: string,
  content: string,
  createdAt: number,
): BuzzMessage {
  return { id, authorPubkey, content, createdAt };
}

function makePipeline(overrides: Record<string, unknown> = {}): AgentPipeline {
  return new AgentPipeline({
    buzz: { getMessages: async () => messages },
    state,
    serviceNsec: "nsec1service",
    servicePubkeyHex: SERVICE_PK,
    complete: complete as unknown as (c: CompleteCall) => Promise<{
      text: string;
      usage: { inputTokens: number; outputTokens: number };
    }>,
    now: () => 1_000_000,
    ...overrides,
  });
}

beforeEach(async () => {
  state = await StateStore.load(
    join(mkdtempSync(join(tmpdir(), "oura-engine-")), "s.json"),
  );
  messages = [];
  calls = [];
  complete = vi.fn(async (c: CompleteCall) => {
    calls.push(c);
    return {
      text: "Здравствуйте! Подскажу. [STATUS:in_progress]",
      usage: { inputTokens: 100, outputTokens: 20 },
    };
  });
});

describe("новые сообщения лида", () => {
  it("нечего отвечать — модель не вызывается", async () => {
    messages = [msg("m1", AGENT_PK, "Здравствуйте!", 10)];
    const outcome = await makePipeline().run(AGENT, LEAD);
    expect(outcome.kind).toBe("skip");
    expect(outcome.kind === "skip" && outcome.reason).toBe("no_new_messages");
    expect(complete).not.toHaveBeenCalled();
  });

  it("несколько сообщений подряд склеиваются в один вызов", async () => {
    messages = [
      msg("m1", LEAD_PK, "Привет", 10),
      msg("m2", LEAD_PK, "Сколько стоит?", 11),
      msg("m3", LEAD_PK, "И есть ли доставка", 12),
    ];
    const outcome = await makePipeline().run(AGENT, LEAD);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(calls[0].userMessage).toBe(
      "Привет\nСколько стоит?\nИ есть ли доставка",
    );
    expect(outcome.kind === "reply" && outcome.consumedEventIds).toEqual([
      "m1",
      "m2",
      "m3",
    ]);
  });

  it("текст ответа очищен от служебных тегов", async () => {
    messages = [msg("m1", LEAD_PK, "Привет", 10)];
    const outcome = await makePipeline().run(AGENT, LEAD);
    expect(outcome.kind === "reply" && outcome.text).toBe(
      "Здравствуйте! Подскажу.",
    );
    expect(outcome.kind === "reply" && outcome.parsed.status).toBe(
      "in_progress",
    );
  });
});

describe("consume-once", () => {
  it("параллельные запуски по одному лиду дают один вызов модели", async () => {
    messages = [msg("m1", LEAD_PK, "Привет", 10)];
    const pipeline = makePipeline();
    const [first, second] = await Promise.all([
      pipeline.run(AGENT, LEAD),
      pipeline.run(AGENT, LEAD),
    ]);
    expect(complete).toHaveBeenCalledTimes(1);
    const outcomes = [first.kind, second.kind].sort();
    expect(outcomes).toEqual(["reply", "skip"]);
    const skipped = first.kind === "skip" ? first : second;
    expect(skipped.kind === "skip" && skipped.reason).toBe("in_flight");
  });

  it("повторный запуск после ответа не отвечает второй раз", async () => {
    messages = [msg("m1", LEAD_PK, "Привет", 10)];
    const pipeline = makePipeline();
    await pipeline.run(AGENT, LEAD);
    const second = await pipeline.run(AGENT, LEAD);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(second.kind === "skip" && second.reason).toBe("no_new_messages");
  });

  it("сбой модели освобождает заявку — следующий запуск пробует снова", async () => {
    messages = [msg("m1", LEAD_PK, "Привет", 10)];
    complete.mockRejectedValueOnce(new Error("модель недоступна"));
    const pipeline = makePipeline();
    const first = await pipeline.run(AGENT, LEAD);
    expect(first.kind === "skip" && first.reason).toBe("llm_error");
    const second = await pipeline.run(AGENT, LEAD);
    expect(second.kind).toBe("reply");
    expect(complete).toHaveBeenCalledTimes(2);
  });
});

describe("история диалога", () => {
  it("роли расставлены, служебные сообщения исключены", async () => {
    messages = [
      msg("m1", LEAD_PK, "Привет", 10),
      msg("m2", SERVICE_PK, "Карточка лида", 11),
      msg("m3", AGENT_PK, "Здравствуйте!", 12),
      msg("m4", OPERATOR_PK, "Уточню у склада", 13),
      msg("m5", LEAD_PK, "Спасибо, жду", 14),
    ];
    state.putAgentLead(LEAD.key, {
      processedEventIds: ["m1"],
      replyAtMs: [],
    });
    await makePipeline().run(AGENT, LEAD);
    expect(calls[0].history).toEqual([
      { role: "user", content: "Привет" },
      { role: "assistant", content: "Здравствуйте!" },
      { role: "assistant", content: "Уточню у склада" },
    ]);
    expect(calls[0].userMessage).toBe("Спасибо, жду");
  });

  it("окно истории ограничено", async () => {
    for (let i = 0; i < 30; i += 1) {
      messages.push(msg(`old-${i}`, AGENT_PK, `реплика ${i}`, i));
    }
    messages.push(msg("new", LEAD_PK, "А сейчас?", 100));
    state.putAgentLead(LEAD.key, { processedEventIds: [], replyAtMs: [] });
    await makePipeline({ historyWindow: 20 }).run(AGENT, LEAD);
    expect(calls[0].history).toHaveLength(20);
    expect(calls[0].history[0].content).toBe("реплика 10");
  });

  it("сообщения лида в истории считаются прочитанными и не отвечаются повторно", async () => {
    messages = [
      msg("m1", LEAD_PK, "Привет", 10),
      msg("m2", AGENT_PK, "Здравствуйте!", 11),
      msg("m3", LEAD_PK, "Сколько стоит?", 12),
    ];
    state.putAgentLead(LEAD.key, {
      processedEventIds: ["m1"],
      replyAtMs: [],
    });
    await makePipeline().run(AGENT, LEAD);
    expect(calls[0].userMessage).toBe("Сколько стоит?");
  });
});

describe("ограничение частоты", () => {
  it("сверх лимита в окне модель не вызывается", async () => {
    messages = [msg("m1", LEAD_PK, "Привет", 10)];
    state.putAgentLead(LEAD.key, {
      processedEventIds: [],
      replyAtMs: [999_000, 999_500, 999_800],
    });
    const outcome = await makePipeline({
      rateLimit: { maxCalls: 3, windowMs: 60_000 },
    }).run(AGENT, LEAD);
    expect(outcome.kind === "skip" && outcome.reason).toBe("rate_limited");
    expect(complete).not.toHaveBeenCalled();
  });

  it("вызовы за пределами окна не учитываются", async () => {
    messages = [msg("m1", LEAD_PK, "Привет", 10)];
    state.putAgentLead(LEAD.key, {
      processedEventIds: [],
      replyAtMs: [100_000, 200_000, 300_000],
    });
    const outcome = await makePipeline({
      rateLimit: { maxCalls: 3, windowMs: 60_000 },
    }).run(AGENT, LEAD);
    expect(outcome.kind).toBe("reply");
  });

  it("успешный ответ учитывается в окне", async () => {
    messages = [msg("m1", LEAD_PK, "Привет", 10)];
    await makePipeline().run(AGENT, LEAD);
    expect(state.getAgentLead(LEAD.key)?.replyAtMs).toEqual([1_000_000]);
  });
});

describe("учёт расхода", () => {
  it("токены пишутся в журнал агента", async () => {
    messages = [msg("m1", LEAD_PK, "Привет", 10)];
    await makePipeline().run(AGENT, LEAD);
    expect(state.getAgentUsage("agent-1")).toEqual({
      calls: 1,
      inputTokens: 100,
      outputTokens: 20,
    });
  });
});
