import { describe, expect, it } from "vitest";
import {
  latestByAgentId,
  parseExternalAgentDef,
  type RelayEvent,
} from "../src/agents/definition.js";

const BRIDGE_PK = "c".repeat(64);

function evt(overrides: Partial<RelayEvent> = {}): RelayEvent {
  return {
    id: "e1",
    pubkey: "a".repeat(64),
    kind: 30177,
    created_at: 1000,
    tags: [
      ["d", "agent-1"],
      ["agent-type", "external"],
      ["source", "telegram"],
      ["bot-token-enc", "шифртекст-b64", BRIDGE_PK],
    ],
    content: JSON.stringify({
      name: "Продавец",
      isActive: true,
      profile: { goal: "продать" },
    }),
    ...overrides,
  };
}

describe("parseExternalAgentDef", () => {
  it("валидное событие → все поля описания", () => {
    const def = parseExternalAgentDef(evt());
    expect(def).toEqual({
      agentId: "agent-1",
      ownerPubkey: "a".repeat(64),
      createdAt: 1000,
      name: "Продавец",
      source: "telegram",
      botTokenEnc: "шифртекст-b64",
      encTargetPubkey: BRIDGE_PK,
      isActive: true,
      profile: { goal: "продать" },
    });
  });

  it("kind ≠ 30177 → null", () => {
    expect(parseExternalAgentDef(evt({ kind: 9 }))).toBeNull();
  });

  it("без agent-type=external (внутренний агент) → null", () => {
    const tags = evt().tags.filter(([t]) => t !== "agent-type");
    expect(parseExternalAgentDef(evt({ tags }))).toBeNull();
  });

  it("без d-тега → null", () => {
    const tags = evt().tags.filter(([t]) => t !== "d");
    expect(parseExternalAgentDef(evt({ tags }))).toBeNull();
  });

  it("source ≠ telegram → null", () => {
    const tags = evt().tags.map((t) =>
      t[0] === "source" ? ["source", "email"] : t,
    );
    expect(parseExternalAgentDef(evt({ tags }))).toBeNull();
  });

  it("без bot-token-enc → null", () => {
    const tags = evt().tags.filter(([t]) => t !== "bot-token-enc");
    expect(parseExternalAgentDef(evt({ tags }))).toBeNull();
  });

  it("bot-token-enc без адресата шифрования → null", () => {
    const tags = evt().tags.map((t) =>
      t[0] === "bot-token-enc" ? ["bot-token-enc", "шифртекст-b64"] : t,
    );
    expect(parseExternalAgentDef(evt({ tags }))).toBeNull();
  });

  it("битый JSON в content → null", () => {
    expect(parseExternalAgentDef(evt({ content: "{оборвано" }))).toBeNull();
  });

  it("content-массив (не объект) → null", () => {
    expect(parseExternalAgentDef(evt({ content: "[1,2]" }))).toBeNull();
  });

  it("isActive по умолчанию true, name по умолчанию пустой, profile — объект", () => {
    const def = parseExternalAgentDef(evt({ content: "{}" }));
    expect(def?.isActive).toBe(true);
    expect(def?.name).toBe("");
    expect(def?.profile).toEqual({});
  });

  it("isActive=false сохраняется", () => {
    const def = parseExternalAgentDef(
      evt({ content: JSON.stringify({ isActive: false }) }),
    );
    expect(def?.isActive).toBe(false);
  });
});

describe("latestByAgentId", () => {
  it("дубли одного агента схлопываются в самый свежий по created_at", () => {
    const older = parseExternalAgentDef(evt({ created_at: 1000 }));
    const newer = parseExternalAgentDef(
      evt({ id: "e2", created_at: 2000 }),
    );
    if (!older || !newer) throw new Error("фикстуры не распарсились");
    expect(latestByAgentId([older, newer])).toEqual([newer]);
    expect(latestByAgentId([newer, older])).toEqual([newer]);
  });

  it("разные агенты сохраняются оба", () => {
    const a = parseExternalAgentDef(evt());
    const b = parseExternalAgentDef(
      evt({
        id: "e2",
        tags: evt().tags.map((t) => (t[0] === "d" ? ["d", "agent-2"] : t)),
      }),
    );
    if (!a || !b) throw new Error("фикстуры не распарсились");
    expect(latestByAgentId([a, b])).toHaveLength(2);
  });
});
