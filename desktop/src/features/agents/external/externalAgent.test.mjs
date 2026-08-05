import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExternalAgentEventInput,
  EXTERNAL_AGENT_DEFAULT_PROFILE,
  isExternalAgentEvent,
  parseExternalAgentEvent,
} from "./externalAgent.ts";

const BRIDGE_PUBKEY = "c".repeat(64);

function draft(overrides = {}) {
  return {
    agentId: "11111111-2222-3333-4444-555555555555",
    name: "Продавец",
    isActive: true,
    botTokenEnc: "nip44-шифртекст",
    bridgePubkey: BRIDGE_PUBKEY,
    profile: {
      ...EXTERNAL_AGENT_DEFAULT_PROFILE,
      goal: "Записать на консультацию",
      role: "sales",
      audience: "Малый бизнес",
      instructions: "Не обещай скидок",
      knowledge: "Работаем с 9 до 18",
    },
    ...overrides,
  };
}

test("событие внешнего агента: kind, теги и content по схеме моста", () => {
  const input = buildExternalAgentEventInput(draft());

  assert.equal(input.kind, 30177);
  assert.deepEqual(input.tags, [
    ["d", "11111111-2222-3333-4444-555555555555"],
    ["agent-type", "external"],
    ["source", "telegram"],
    ["bot-token-enc", "nip44-шифртекст", BRIDGE_PUBKEY],
  ]);

  const content = JSON.parse(input.content);
  assert.equal(content.name, "Продавец");
  assert.equal(content.isActive, true);
  assert.equal(content.profile.goal, "Записать на консультацию");
  assert.equal(content.profile.role, "sales");
  assert.equal(content.profile.tone.language, "russian");
});

test("roundtrip: собранное событие разбирается обратно без потерь", () => {
  const source = draft();
  const input = buildExternalAgentEventInput(source);
  const record = parseExternalAgentEvent({
    id: "evt-1",
    pubkey: "a".repeat(64),
    kind: input.kind,
    created_at: 1700000000,
    tags: input.tags,
    content: input.content,
  });

  assert.ok(record);
  assert.equal(record.agentId, source.agentId);
  assert.equal(record.name, source.name);
  assert.equal(record.isActive, true);
  assert.equal(record.bridgePubkey, BRIDGE_PUBKEY);
  assert.equal(record.botTokenEnc, "nip44-шифртекст");
  assert.deepEqual(record.profile, source.profile);
  assert.equal(record.ownerPubkey, "a".repeat(64));
});

test("внутренний агент (без тега agent-type) не считается внешним", () => {
  const internal = {
    id: "evt-2",
    pubkey: "b".repeat(64),
    kind: 30177,
    created_at: 1,
    tags: [["d", "b".repeat(64)]],
    content: JSON.stringify({ name: "Локальный" }),
  };

  assert.equal(isExternalAgentEvent(internal), false);
  assert.equal(parseExternalAgentEvent(internal), null);
});

test("битые события отбрасываются, а не роняют разбор", () => {
  const base = buildExternalAgentEventInput(draft());
  const evt = (overrides) => ({
    id: "e",
    pubkey: "a".repeat(64),
    kind: 30177,
    created_at: 1,
    tags: base.tags,
    content: base.content,
    ...overrides,
  });

  assert.equal(parseExternalAgentEvent(evt({ kind: 9 })), null);
  assert.equal(parseExternalAgentEvent(evt({ content: "{оборвано" })), null);
  assert.equal(
    parseExternalAgentEvent(
      evt({ tags: base.tags.filter(([t]) => t !== "d") }),
    ),
    null,
  );
  assert.equal(
    parseExternalAgentEvent(
      evt({ tags: base.tags.filter(([t]) => t !== "bot-token-enc") }),
    ),
    null,
  );
});

test("выключенный агент сохраняет isActive=false", () => {
  const input = buildExternalAgentEventInput(draft({ isActive: false }));
  assert.equal(JSON.parse(input.content).isActive, false);
});

test("профиль по умолчанию — дружелюбный русский продажник", () => {
  assert.equal(EXTERNAL_AGENT_DEFAULT_PROFILE.role, "sales");
  assert.equal(EXTERNAL_AGENT_DEFAULT_PROFILE.tone.formality, "friendly");
  assert.equal(EXTERNAL_AGENT_DEFAULT_PROFILE.tone.language, "russian");
  assert.equal(EXTERNAL_AGENT_DEFAULT_PROFILE.tone.maxEmojis, 2);
  assert.equal(EXTERNAL_AGENT_DEFAULT_PROFILE.tone.maxLength, "medium");
});

test("неизвестные поля профиля не ломают разбор, известные нормализуются", () => {
  const record = parseExternalAgentEvent({
    id: "e",
    pubkey: "a".repeat(64),
    kind: 30177,
    created_at: 1,
    tags: [
      ["d", "agent-x"],
      ["agent-type", "external"],
      ["source", "telegram"],
      ["bot-token-enc", "enc", BRIDGE_PUBKEY],
    ],
    content: JSON.stringify({
      name: "X",
      profile: { goal: "цель", лишнее: 1 },
    }),
  });

  assert.ok(record);
  assert.equal(record.profile.goal, "цель");
  assert.equal(record.profile.role, "sales");
  assert.equal(record.isActive, true, "isActive по умолчанию включён");
});
