import assert from "node:assert/strict";
import test from "node:test";

import { externalAgentsFromEvents } from "./externalAgentApi.ts";
import { buildExternalAgentEventInput } from "./externalAgent.ts";
import {
  assertNotExternalAgent,
  isExternalAgentPubkey,
} from "./externalAgentGuards.ts";

const BRIDGE = "c".repeat(64);
const OWNER = "a".repeat(64);

function externalEvent(agentId, createdAt = 1000) {
  const input = buildExternalAgentEventInput({
    agentId,
    name: agentId,
    isActive: true,
    botTokenEnc: "enc",
    bridgePubkey: BRIDGE,
    profile: {
      goal: "цель",
      role: "sales",
      tone: {
        formality: "friendly",
        maxEmojis: 2,
        maxLength: "medium",
        language: "russian",
      },
      audience: "",
      instructions: "",
      knowledge: "",
    },
  });
  return {
    id: `${agentId}-${createdAt}`,
    pubkey: OWNER,
    kind: input.kind,
    created_at: createdAt,
    tags: input.tags,
    content: input.content,
    sig: "",
  };
}

const internalEvent = {
  id: "internal",
  pubkey: OWNER,
  kind: 30177,
  created_at: 500,
  tags: [["d", "b".repeat(64)]],
  content: JSON.stringify({ name: "Локальный агент" }),
  sig: "",
};

test("из ленты событий отбираются только внешние агенты", () => {
  const records = externalAgentsFromEvents([
    internalEvent,
    externalEvent("agent-1"),
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0].agentId, "agent-1");
});

test("дубли одного агента схлопываются в самый свежий", () => {
  const records = externalAgentsFromEvents([
    externalEvent("agent-1", 1000),
    externalEvent("agent-1", 3000),
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0].createdAt, 3000);
});

test("список отсортирован от свежих к старым", () => {
  const records = externalAgentsFromEvents([
    externalEvent("старый", 100),
    externalEvent("новый", 900),
  ]);
  assert.deepEqual(
    records.map((r) => r.agentId),
    ["новый", "старый"],
  );
});

test("внешний агент опознаётся по своему идентификатору при добавлении в канал", () => {
  const records = externalAgentsFromEvents([externalEvent("agent-1")]);
  assert.equal(isExternalAgentPubkey("agent-1", records), true);
  assert.equal(isExternalAgentPubkey("другой-агент", records), false);
  assert.equal(isExternalAgentPubkey(null, records), false);
  assert.equal(isExternalAgentPubkey("agent-1", []), false);
});

test("агент опознаётся и по ключу, которым он пишет в комнатах обращений", () => {
  const AGENT_PUBKEY = "f".repeat(64);
  const withKey = {
    ...externalEvent("agent-1"),
    tags: [...externalEvent("agent-1").tags, ["agent-pubkey", AGENT_PUBKEY]],
  };
  const records = externalAgentsFromEvents([withKey]);

  assert.equal(records[0].agentPubkey, AGENT_PUBKEY);
  assert.equal(isExternalAgentPubkey(AGENT_PUBKEY, records), true);
  assert.equal(
    isExternalAgentPubkey(AGENT_PUBKEY.toUpperCase(), records),
    true,
    "регистр hex-ключа не должен обходить блокировку",
  );
});

test("блокировка добавления в канал бросает понятную ошибку", () => {
  const records = externalAgentsFromEvents([externalEvent("agent-1")]);
  assert.throws(
    () => assertNotExternalAgent("agent-1", records),
    /комнатах обращений/,
  );
  assert.doesNotThrow(() => assertNotExternalAgent("внутренний", records));
});
