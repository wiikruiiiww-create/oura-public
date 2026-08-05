import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ApprovalDeps,
  type ApprovalLead,
  deliverApprovedDrafts,
} from "../src/engine/approval.js";
import { StateStore } from "../src/state.js";
import type { OutboundMessage } from "../src/types.js";
import { PermanentDeliveryError } from "../src/types.js";

const AGENT_PK = "a9e7".padEnd(64, "0");
const OPERATOR_PK = "0f11".padEnd(64, "0");
const LEAD: ApprovalLead = {
  key: "tg:agent-1:42",
  chatId: "42",
  pubkeyHex: "1ead".padEnd(64, "0"),
};

let state: StateStore;
let delivered: OutboundMessage[];
let deliverImpl: (m: OutboundMessage) => Promise<void>;
let reactions: Array<Record<string, unknown>>;
let requests: Array<{ url: string; body: unknown }>;

function reaction(
  targetEventId: string,
  pubkey: string,
  content = "👍",
): Record<string, unknown> {
  return {
    id: `r-${targetEventId}-${pubkey.slice(0, 4)}`,
    pubkey,
    kind: 7,
    content,
    created_at: 100,
    tags: [["e", targetEventId]],
  };
}

const fetchImpl = (async (url: string, init?: RequestInit) => {
  requests.push({ url, body: JSON.parse(String(init?.body ?? "null")) });
  return new Response(JSON.stringify(reactions), { status: 200 });
}) as unknown as typeof fetch;

function deps(overrides: Partial<ApprovalDeps> = {}): ApprovalDeps {
  return {
    state,
    sink: { deliver: (m) => deliverImpl(m) },
    relayUrl: "http://relay.test",
    serviceNsec:
      "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5",
    fetchImpl,
    now: () => 1_000_000,
    ...overrides,
  };
}

async function seedDraft(eventId: string, text: string, createdAtMs = 999_000) {
  const record = state.getAgentLead(LEAD.key) ?? {
    processedEventIds: [],
    replyAtMs: [],
  };
  state.putAgentLead(LEAD.key, {
    ...record,
    pendingDrafts: [
      ...(record.pendingDrafts ?? []),
      { eventId, text, createdAtMs },
    ],
  });
  await state.save();
}

beforeEach(async () => {
  state = await StateStore.load(
    join(mkdtempSync(join(tmpdir(), "oura-approval-")), "s.json"),
  );
  delivered = [];
  deliverImpl = async (m) => void delivered.push(m);
  reactions = [];
  requests = [];
});

describe("одобрение черновика", () => {
  it("👍 оператора доставляет чистый текст клиенту один раз", async () => {
    await seedDraft("d1", "Работаем с 9 до 18.");
    reactions = [reaction("d1", OPERATOR_PK)];
    const first = await deliverApprovedDrafts(deps(), AGENT_PK, LEAD);
    const second = await deliverApprovedDrafts(deps(), AGENT_PK, LEAD);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect(delivered).toEqual([{ chatId: "42", text: "Работаем с 9 до 18." }]);
    expect(state.getAgentLead(LEAD.key)?.pendingDrafts).toEqual([]);
  });

  it("реакция «+» тоже считается одобрением", async () => {
    await seedDraft("d1", "текст");
    reactions = [reaction("d1", OPERATOR_PK, "+")];
    expect(await deliverApprovedDrafts(deps(), AGENT_PK, LEAD)).toHaveLength(1);
  });

  it("сам агент одобрить себя не может", async () => {
    await seedDraft("d1", "текст");
    reactions = [reaction("d1", AGENT_PK)];
    expect(await deliverApprovedDrafts(deps(), AGENT_PK, LEAD)).toHaveLength(0);
    expect(delivered).toEqual([]);
  });

  it("лид одобрить себе ответ не может", async () => {
    await seedDraft("d1", "текст");
    reactions = [reaction("d1", LEAD.pubkeyHex)];
    expect(await deliverApprovedDrafts(deps(), AGENT_PK, LEAD)).toHaveLength(0);
  });

  it("другая реакция не одобряет", async () => {
    await seedDraft("d1", "текст");
    reactions = [reaction("d1", OPERATOR_PK, "❤️")];
    expect(await deliverApprovedDrafts(deps(), AGENT_PK, LEAD)).toHaveLength(0);
  });

  it("запрос к relay ограничен kind 7 и черновиками — иначе п-гейт", async () => {
    await seedDraft("d1", "текст");
    await deliverApprovedDrafts(deps(), AGENT_PK, LEAD);
    expect(requests[0].url).toBe("http://relay.test/query");
    expect(requests[0].body).toEqual([
      { kinds: [7], "#e": ["d1"], limit: 200 },
    ]);
  });

  it("без черновиков relay не опрашивается", async () => {
    await deliverApprovedDrafts(deps(), AGENT_PK, LEAD);
    expect(requests).toHaveLength(0);
  });
});

describe("сбои доставки", () => {
  it("навсегда недоставимый черновик снимается и в историю не попадает", async () => {
    await seedDraft("d1", "текст");
    reactions = [reaction("d1", OPERATOR_PK)];
    deliverImpl = async () => {
      throw new PermanentDeliveryError("клиент заблокировал бота");
    };
    await deliverApprovedDrafts(deps(), AGENT_PK, LEAD);
    const record = state.getAgentLead(LEAD.key);
    expect(record?.pendingDrafts).toEqual([]);
    expect(record?.undeliveredDraftEventIds).toEqual(["d1"]);
  });

  it("временный сбой оставляет черновик до следующей попытки", async () => {
    await seedDraft("d1", "текст");
    reactions = [reaction("d1", OPERATOR_PK)];
    deliverImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("сеть недоступна"))
      .mockImplementation(async (m: OutboundMessage) => void delivered.push(m));
    await deliverApprovedDrafts(deps(), AGENT_PK, LEAD);
    expect(state.getAgentLead(LEAD.key)?.pendingDrafts).toHaveLength(1);
    await deliverApprovedDrafts(deps(), AGENT_PK, LEAD);
    expect(delivered).toEqual([{ chatId: "42", text: "текст" }]);
  });

  it("недоступный relay не теряет черновик", async () => {
    await seedDraft("d1", "текст");
    const failing = (async () =>
      new Response("boom", { status: 500 })) as unknown as typeof fetch;
    await expect(
      deliverApprovedDrafts(deps({ fetchImpl: failing }), AGENT_PK, LEAD),
    ).rejects.toThrow();
    expect(state.getAgentLead(LEAD.key)?.pendingDrafts).toHaveLength(1);
  });
});

describe("устаревание", () => {
  it("просроченный черновик снимается и клиенту уже не уйдёт", async () => {
    await seedDraft("d1", "вчерашний ответ", 1_000);
    reactions = [reaction("d1", OPERATOR_PK)];
    await deliverApprovedDrafts(deps({ draftTtlMs: 60_000 }), AGENT_PK, LEAD);
    expect(delivered).toEqual([]);
    const record = state.getAgentLead(LEAD.key);
    expect(record?.pendingDrafts).toEqual([]);
    expect(record?.undeliveredDraftEventIds).toEqual(["d1"]);
  });
});
