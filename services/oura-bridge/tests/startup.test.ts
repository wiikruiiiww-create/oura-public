import { describe, expect, it } from "vitest";
import { decideStartup } from "../src/startup.js";

const OPERATOR = "ab".repeat(32);

describe("decideStartup", () => {
  it("telegram с операторами — ок, без предупреждений", () => {
    const d = decideStartup({
      source: "telegram",
      operatorPubkeys: [OPERATOR],
    });
    expect(d).toEqual({ ok: true, source: "telegram", warnings: [] });
  });

  it("telegram с пустым allow-list операторов — отказ старта (B3)", () => {
    const d = decideStartup({ source: "telegram", operatorPubkeys: [] });
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.errors.join("\n")).toContain("OURA_OPERATOR_PUBKEYS");
    }
  });

  it("stub с пустым allow-list — ок, но с предупреждением дев-стенда", () => {
    const d = decideStartup({ source: "stub", operatorPubkeys: [] });
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.source).toBe("stub");
      expect(d.warnings).toHaveLength(1);
      expect(d.warnings[0]).toContain("OURA_OPERATOR_PUBKEYS");
    }
  });

  it("stub с операторами — ок, без предупреждений", () => {
    const d = decideStartup({ source: "stub", operatorPubkeys: [OPERATOR] });
    expect(d).toEqual({ ok: true, source: "stub", warnings: [] });
  });

  it("незаданный OURA_SOURCE — отказ старта (дефолта stub больше нет)", () => {
    const d = decideStartup({ source: undefined, operatorPubkeys: [OPERATOR] });
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.errors.join("\n")).toContain("OURA_SOURCE");
    }
  });

  it("неизвестный OURA_SOURCE — отказ старта", () => {
    const d = decideStartup({ source: "smoke", operatorPubkeys: [OPERATOR] });
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.errors.join("\n")).toContain("smoke");
    }
  });
});
