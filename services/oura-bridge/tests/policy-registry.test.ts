import { describe, expect, it } from "vitest";
import {
  IdentityRegistry,
  type IdentityRecord,
} from "../src/policy/registry.js";

const hexA = "ab".repeat(32);
const hexB = "cd".repeat(32);
const hexC = "ef".repeat(32);

describe("IdentityRegistry", () => {
  it("регистрирует ключ и классифицирует его", () => {
    const reg = new IdentityRegistry();
    reg.register({ pubkeyHex: hexA, class: "operator" });
    expect(reg.classify(hexA)).toBe("operator");
  });

  it("незнакомый ключ классифицируется как null (fail-closed)", () => {
    const reg = new IdentityRegistry();
    expect(reg.classify(hexA)).toBeNull();
  });

  it("нормализует pubkey при регистрации и при запросе (регистр/пробелы)", () => {
    const reg = new IdentityRegistry();
    reg.register({ pubkeyHex: ` ${hexA.toUpperCase()} `, class: "lead" });
    expect(reg.classify(hexA)).toBe("lead");
    expect(reg.classify(hexA.toUpperCase())).toBe("lead");
  });

  it("отвергает pubkey неверного формата", () => {
    const reg = new IdentityRegistry();
    expect(() =>
      reg.register({ pubkeyHex: "not-a-pubkey", class: "lead" }),
    ).toThrow(/pubkey/);
  });

  it("повторная регистрация с тем же классом идемпотентна", () => {
    const reg = new IdentityRegistry();
    reg.register({ pubkeyHex: hexA, class: "service" });
    expect(() =>
      reg.register({ pubkeyHex: hexA, class: "service" }),
    ).not.toThrow();
    expect(reg.list("service")).toHaveLength(1);
  });

  it("смена класса ключа запрещена — у ключа ровно один класс", () => {
    const reg = new IdentityRegistry();
    reg.register({ pubkeyHex: hexA, class: "lead" });
    expect(() => reg.register({ pubkeyHex: hexA, class: "operator" })).toThrow(
      /класс/,
    );
    expect(reg.classify(hexA)).toBe("lead");
  });

  it("list фильтрует по классу", () => {
    const reg = new IdentityRegistry();
    reg.register({ pubkeyHex: hexA, class: "operator" });
    reg.register({ pubkeyHex: hexB, class: "operator" });
    reg.register({ pubkeyHex: hexC, class: "lead" });
    expect(
      reg.list("operator").map((r: IdentityRecord) => r.pubkeyHex),
    ).toEqual([hexA, hexB]);
    expect(reg.list()).toHaveLength(3);
  });

  it("toJSON/fromJSON — полный roundtrip", () => {
    const reg = new IdentityRegistry();
    reg.register({ pubkeyHex: hexA, class: "service", label: "мост" });
    reg.register({ pubkeyHex: hexB, class: "internal_agent" });
    const restored = IdentityRegistry.fromJSON(reg.toJSON());
    expect(restored.classify(hexA)).toBe("service");
    expect(restored.classify(hexB)).toBe("internal_agent");
    expect(restored.list("service")[0]?.label).toBe("мост");
  });

  it("fromJSON отвергает запись с неизвестным классом (fail-fast, не тихая потеря)", () => {
    expect(() =>
      IdentityRegistry.fromJSON({
        identities: [{ pubkeyHex: hexA, class: "superuser" }],
      }),
    ).toThrow(/класс/);
  });
});
