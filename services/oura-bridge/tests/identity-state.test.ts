import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mintIdentity } from "../src/identity.js";
import { StateStore } from "../src/state.js";

describe("mintIdentity", () => {
  it("выдаёт nsec и 64-символьный hex-pubkey, ключи уникальны", () => {
    const a = mintIdentity();
    const b = mintIdentity();
    expect(a.nsec).toMatch(/^nsec1/);
    expect(a.pubkeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(a.nsec).not.toBe(b.nsec);
  });
});

describe("StateStore", () => {
  it("сохраняет и загружает лидов и seen-множество", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "oura-state-")), "bridge.state.json");
    const s1 = await StateStore.load(path);
    expect(s1.getLead("42")).toBeUndefined();
    s1.putLead({ chatId: "42", name: "Иван", nsec: "nsec1x", pubkeyHex: "ab".repeat(32), channelId: "chan-1" });
    s1.markSeen("ev1");
    await s1.save();

    const s2 = await StateStore.load(path);
    expect(s2.getLead("42")?.channelId).toBe("chan-1");
    expect(s2.allLeads()).toHaveLength(1);
    expect(s2.hasSeen("ev1")).toBe(true);
    expect(s2.hasSeen("ev2")).toBe(false);
  });

  it("ограничивает seen-множество последними 5000 id", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "oura-state-")), "bridge.state.json");
    const s = await StateStore.load(path);
    for (let i = 0; i < 5100; i++) s.markSeen(`ev${i}`);
    expect(s.hasSeen("ev0")).toBe(false);
    expect(s.hasSeen("ev5099")).toBe(true);
  });

  it("конкурентные save сериализуются и не портят файл", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "oura-state-")), "bridge.state.json");
    const s = await StateStore.load(path);
    s.putLead({ chatId: "1", name: "a", nsec: "nsec1a", pubkeyHex: "a".repeat(64), channelId: "c1" });
    await Promise.all([s.save(), s.save(), s.save()]);
    const s2 = await StateStore.load(path);
    expect(s2.getLead("1")?.channelId).toBe("c1");
  });
});
