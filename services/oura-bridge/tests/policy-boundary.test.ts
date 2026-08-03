import { describe, expect, it } from "vitest";
import {
  canBeMember,
  canRelayOutbound,
  type MembershipQuery,
} from "../src/policy/boundary.js";

function q(partial: Partial<MembershipQuery>): MembershipQuery {
  return {
    actor: "operator",
    channel: "team",
    isOwnLeadRoom: false,
    ...partial,
  };
}

describe("canBeMember — инварианты границы блоков (Р8, Р10, Р7)", () => {
  it("service: member везде (владелец лид-комнат)", () => {
    expect(
      canBeMember(q({ actor: "service", channel: "lead_room" })).allowed,
    ).toBe(true);
    expect(canBeMember(q({ actor: "service", channel: "team" })).allowed).toBe(
      true,
    );
  });

  it("lead: member ТОЛЬКО своей лид-комнаты", () => {
    expect(
      canBeMember(
        q({ actor: "lead", channel: "lead_room", isOwnLeadRoom: true }),
      ).allowed,
    ).toBe(true);
    expect(
      canBeMember(
        q({ actor: "lead", channel: "lead_room", isOwnLeadRoom: false }),
      ).allowed,
    ).toBe(false);
    expect(canBeMember(q({ actor: "lead", channel: "team" })).allowed).toBe(
      false,
    );
  });

  it("operator: member командных каналов и лид-комнат (Р7 — список общий на команду)", () => {
    expect(canBeMember(q({ actor: "operator", channel: "team" })).allowed).toBe(
      true,
    );
    expect(
      canBeMember(q({ actor: "operator", channel: "lead_room" })).allowed,
    ).toBe(true);
  });

  it("external_agent: только лид-комнаты, во внутренний блок не ходит", () => {
    expect(
      canBeMember(q({ actor: "external_agent", channel: "lead_room" })).allowed,
    ).toBe(true);
    expect(
      canBeMember(q({ actor: "external_agent", channel: "team" })).allowed,
    ).toBe(false);
  });

  it("internal_agent: НИКОГДА не member лид-комнаты (Р10)", () => {
    const d = canBeMember(q({ actor: "internal_agent", channel: "lead_room" }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/Р10/);
    expect(
      canBeMember(q({ actor: "internal_agent", channel: "team" })).allowed,
    ).toBe(true);
  });

  it("неклассифицированный ключ (null): deny по умолчанию (fail-closed)", () => {
    expect(canBeMember(q({ actor: null, channel: "team" })).allowed).toBe(
      false,
    );
    expect(canBeMember(q({ actor: null, channel: "lead_room" })).allowed).toBe(
      false,
    );
  });

  it("каждый deny несёт машиночитаемую причину", () => {
    const d = canBeMember(q({ actor: "lead", channel: "team" }));
    expect(d.allowed).toBe(false);
    expect(d.reason.length).toBeGreaterThan(0);
  });
});

describe("canRelayOutbound — кто выпускается во внешний канал (Р11)", () => {
  it("operator и external_agent — да", () => {
    expect(canRelayOutbound("operator")).toBe(true);
    expect(canRelayOutbound("external_agent")).toBe(true);
  });

  it("lead, service, internal_agent, неизвестный — нет", () => {
    expect(canRelayOutbound("lead")).toBe(false);
    expect(canRelayOutbound("service")).toBe(false);
    expect(canRelayOutbound("internal_agent")).toBe(false);
    expect(canRelayOutbound(null)).toBe(false);
  });
});
