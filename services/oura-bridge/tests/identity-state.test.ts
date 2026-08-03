import { mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mintIdentity, parseOperatorPubkeys } from "../src/identity.js";
import { StateStore } from "../src/state.js";

function tmpStatePath(): string {
  return join(mkdtempSync(join(tmpdir(), "oura-state-")), "bridge.state.json");
}

describe("mintIdentity", () => {
  it("выдаёт nsec и 64-символьный hex-pubkey, ключи уникальны", () => {
    const a = mintIdentity();
    const b = mintIdentity();
    expect(a.nsec).toMatch(/^nsec1/);
    expect(a.pubkeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(a.nsec).not.toBe(b.nsec);
  });
});

describe("parseOperatorPubkeys", () => {
  it("тримит и приводит к нижнему регистру, отбрасывает пустые записи", () => {
    const hex = "ab".repeat(32);
    const result = parseOperatorPubkeys(` ${hex.toUpperCase()} , , ${hex}`);
    expect(result.valid).toEqual([hex, hex]);
    expect(result.invalid).toEqual([]);
  });

  it("пустая строка даёт пустой allow-list без ошибок", () => {
    expect(parseOperatorPubkeys("")).toEqual({ valid: [], invalid: [] });
  });

  it("отделяет записи неверного формата (не 64 hex-символа) в invalid", () => {
    const hex = "cd".repeat(32);
    const result = parseOperatorPubkeys(
      `${hex},not-a-pubkey,${hex.slice(0, 10)}`,
    );
    expect(result.valid).toEqual([hex]);
    expect(result.invalid).toEqual(["not-a-pubkey", hex.slice(0, 10)]);
  });
});

describe("StateStore", () => {
  it("сохраняет и загружает лидов и seen-множество", async () => {
    const path = join(
      mkdtempSync(join(tmpdir(), "oura-state-")),
      "bridge.state.json",
    );
    const s1 = await StateStore.load(path);
    expect(s1.getLead("42")).toBeUndefined();
    s1.putLead({
      chatId: "42",
      name: "Иван",
      nsec: "nsec1x",
      pubkeyHex: "ab".repeat(32),
      channelId: "chan-1",
    });
    s1.markSeen("42", "ev1");
    await s1.save();

    const s2 = await StateStore.load(path);
    expect(s2.getLead("42")?.channelId).toBe("chan-1");
    expect(s2.allLeads()).toHaveLength(1);
    expect(s2.hasSeen("42", "ev1")).toBe(true);
    expect(s2.hasSeen("42", "ev2")).toBe(false);
  });

  it("ограничивает seen-множество последними 500 id на лид", async () => {
    const path = join(
      mkdtempSync(join(tmpdir(), "oura-state-")),
      "bridge.state.json",
    );
    const s = await StateStore.load(path);
    for (let i = 0; i < 501; i++) s.markSeen("42", `ev${i}`);
    expect(s.hasSeen("42", "ev0")).toBe(false);
    expect(s.hasSeen("42", "ev500")).toBe(true);
  });

  it("конкурентные save сериализуются и не портят файл", async () => {
    const path = join(
      mkdtempSync(join(tmpdir(), "oura-state-")),
      "bridge.state.json",
    );
    const s = await StateStore.load(path);
    s.putLead({
      chatId: "1",
      name: "a",
      nsec: "nsec1a",
      pubkeyHex: "a".repeat(64),
      channelId: "c1",
    });
    await Promise.all([s.save(), s.save(), s.save()]);
    const s2 = await StateStore.load(path);
    expect(s2.getLead("1")?.channelId).toBe("c1");
  });

  describe("устойчивость state-файла (этап 0 hotfix)", () => {
    it("битый JSON роняет load с подсказкой про .bak, а не стартует молча с нуля", async () => {
      const path = tmpStatePath();
      await writeFile(path, "{ это не json", "utf8");
      await expect(StateStore.load(path)).rejects.toThrow(/\.bak/);
    });

    it("валидный JSON неожиданной формы (без leads) тоже роняет load", async () => {
      const path = tmpStatePath();
      await writeFile(path, JSON.stringify(["не", "тот", "формат"]), "utf8");
      await expect(StateStore.load(path)).rejects.toThrow(/\.bak/);
    });

    it("отсутствующий файл (ENOENT) — единственный случай пустого старта", async () => {
      const state = await StateStore.load(tmpStatePath());
      expect(state.allLeads()).toEqual([]);
    });

    it("save сохраняет предыдущую версию файла в .bak", async () => {
      const path = tmpStatePath();
      const s1 = await StateStore.load(path);
      s1.putLead({
        chatId: "1",
        name: "v1",
        nsec: "nsec1a",
        pubkeyHex: "a".repeat(64),
        channelId: "c1",
      });
      await s1.save(); // первой записи предшествовал ENOENT — .bak не обязателен
      s1.putLead({
        chatId: "2",
        name: "v2",
        nsec: "nsec1b",
        pubkeyHex: "b".repeat(32 * 2),
        channelId: "c2",
      });
      await s1.save();

      const bak = JSON.parse(await readFile(`${path}.bak`, "utf8")) as {
        leads: Record<string, unknown>;
      };
      expect(Object.keys(bak.leads)).toEqual(["1"]); // .bak = версия ДО последней записи
      const restored = await StateStore.load(`${path}.bak`);
      expect(restored.getLead("1")?.channelId).toBe("c1");
    });
  });

  describe("per-lead seen (I4)", () => {
    it("markSeen/hasSeen изолированы по лидам", async () => {
      const state = await StateStore.load(tmpStatePath());
      state.markSeen("42", "ev-1");
      expect(state.hasSeen("42", "ev-1")).toBe(true);
      expect(state.hasSeen("99", "ev-1")).toBe(false);
    });

    it("кап 500 вытесняет старые id только внутри своего лида", async () => {
      const state = await StateStore.load(tmpStatePath());
      state.markSeen("other", "keep-me");
      for (let i = 0; i < 501; i++) state.markSeen("42", `ev-${i}`);
      expect(state.hasSeen("42", "ev-0")).toBe(false); // вытеснен
      expect(state.hasSeen("42", "ev-500")).toBe(true);
      expect(state.hasSeen("other", "keep-me")).toBe(true); // сосед не пострадал
    });

    it("legacy seenEventIds из файла Фазы 0 продолжают считаться seen у любого лида", async () => {
      const path = tmpStatePath();
      await writeFile(
        path,
        JSON.stringify({ leads: {}, seenEventIds: ["legacy-ev"] }),
        "utf8",
      );
      const state = await StateStore.load(path);
      expect(state.hasSeen("42", "legacy-ev")).toBe(true);
      expect(state.hasSeen("99", "legacy-ev")).toBe(true);
    });

    it("per-lead seen переживает save/load", async () => {
      const path = tmpStatePath();
      const state = await StateStore.load(path);
      state.markSeen("42", "ev-1");
      await state.save();
      const reloaded = await StateStore.load(path);
      expect(reloaded.hasSeen("42", "ev-1")).toBe(true);
    });
  });
});
