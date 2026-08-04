import { describe, expect, it } from "vitest";
import type { ExternalAgentDef } from "../src/agents/definition.js";
import {
  SourceManager,
  type StartedSource,
} from "../src/sources/source-manager.js";

function def(
  agentId: string,
  overrides: Partial<ExternalAgentDef> = {},
): ExternalAgentDef {
  return {
    agentId,
    ownerPubkey: "a".repeat(64),
    createdAt: 1000,
    name: agentId,
    source: "telegram",
    botTokenEnc: `enc-${agentId}`,
    encTargetPubkey: "c".repeat(64),
    isActive: true,
    profile: {},
    ...overrides,
  };
}

interface Journal {
  started: string[];
  stopped: string[];
}

function makeManager(opts?: {
  decrypt?: (d: ExternalAgentDef) => string;
  failCreateFor?: Set<string>;
}): { manager: SourceManager; journal: Journal } {
  const journal: Journal = { started: [], stopped: [] };
  const manager = new SourceManager({
    decryptToken: opts?.decrypt ?? ((d) => `token-${d.botTokenEnc}`),
    factory: {
      async create(d, _token): Promise<StartedSource> {
        if (opts?.failCreateFor?.has(d.agentId)) {
          throw new Error(`бот ${d.agentId} не стартовал`);
        }
        journal.started.push(d.agentId);
        return {
          async stop() {
            journal.stopped.push(d.agentId);
          },
        };
      },
    },
    log: () => {},
  });
  return { manager, journal };
}

describe("SourceManager.reconcile", () => {
  it("новый активный агент стартует, статус running", async () => {
    const { manager, journal } = makeManager();
    await manager.reconcile([def("a1")]);
    expect(journal.started).toEqual(["a1"]);
    expect(manager.statuses().get("a1")).toBe("running");
  });

  it("повторный reconcile с тем же набором ничего не перезапускает", async () => {
    const { manager, journal } = makeManager();
    await manager.reconcile([def("a1")]);
    await manager.reconcile([def("a1")]);
    expect(journal.started).toEqual(["a1"]);
    expect(journal.stopped).toEqual([]);
  });

  it("исчезнувший из снапшота агент останавливается", async () => {
    const { manager, journal } = makeManager();
    await manager.reconcile([def("a1"), def("a2", { botTokenEnc: "enc-x" })]);
    await manager.reconcile([def("a1")]);
    expect(journal.stopped).toEqual(["a2"]);
    expect(manager.statuses().has("a2")).toBe(false);
  });

  it("isActive=false останавливает бота, статус inactive", async () => {
    const { manager, journal } = makeManager();
    await manager.reconcile([def("a1")]);
    await manager.reconcile([def("a1", { isActive: false })]);
    expect(journal.stopped).toEqual(["a1"]);
    expect(manager.statuses().get("a1")).toBe("inactive");
  });

  it("смена токена перезапускает бота", async () => {
    const { manager, journal } = makeManager();
    await manager.reconcile([def("a1")]);
    await manager.reconcile([def("a1", { botTokenEnc: "enc-новый" })]);
    expect(journal.stopped).toEqual(["a1"]);
    expect(journal.started).toEqual(["a1", "a1"]);
    expect(manager.statuses().get("a1")).toBe("running");
  });

  it("один токен у двух агентов: работает старейший, второй — conflict", async () => {
    const { manager, journal } = makeManager({
      decrypt: () => "общий-токен",
    });
    await manager.reconcile([
      def("младший", { createdAt: 2000 }),
      def("старейший", { createdAt: 1000 }),
    ]);
    expect(journal.started).toEqual(["старейший"]);
    expect(manager.statuses().get("старейший")).toBe("running");
    expect(manager.statuses().get("младший")).toBe("conflict");
  });

  it("ошибка старта одного бота не мешает остальным, статус error", async () => {
    const { manager, journal } = makeManager({
      failCreateFor: new Set(["сломанный"]),
    });
    await manager.reconcile([
      def("сломанный"),
      def("здоровый", { botTokenEnc: "enc-z" }),
    ]);
    expect(journal.started).toEqual(["здоровый"]);
    expect(manager.statuses().get("сломанный")).toBe("error");
    expect(manager.statuses().get("здоровый")).toBe("running");
  });

  it("ошибка расшифровки токена → error, без падения reconcile", async () => {
    const { manager, journal } = makeManager({
      decrypt: (d) => {
        if (d.agentId === "битый") throw new Error("не расшифровалось");
        return "токен";
      },
    });
    await manager.reconcile([def("битый")]);
    expect(journal.started).toEqual([]);
    expect(manager.statuses().get("битый")).toBe("error");
  });

  it("после error следующий reconcile пробует стартовать снова", async () => {
    const failures = new Set(["a1"]);
    const { manager, journal } = makeManager({ failCreateFor: failures });
    await manager.reconcile([def("a1")]);
    expect(manager.statuses().get("a1")).toBe("error");
    failures.delete("a1");
    await manager.reconcile([def("a1")]);
    expect(journal.started).toEqual(["a1"]);
    expect(manager.statuses().get("a1")).toBe("running");
  });

  it("stopAll останавливает всех запущенных", async () => {
    const { manager, journal } = makeManager();
    await manager.reconcile([def("a1"), def("a2", { botTokenEnc: "enc-2" })]);
    await manager.stopAll();
    expect(journal.stopped.sort()).toEqual(["a1", "a2"]);
  });
});
