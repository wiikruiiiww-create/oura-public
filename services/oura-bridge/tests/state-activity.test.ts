import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StateStore } from "../src/state.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function tmpStatePath(): string {
  return join(mkdtempSync(join(tmpdir(), "oura-activity-")), "s.json");
}

function lead(chatId: string) {
  return {
    chatId,
    name: `lead-${chatId}`,
    nsec: `nsec1${chatId}`,
    pubkeyHex: chatId.padEnd(64, "0"),
    channelId: `chan-${chatId}`,
  };
}

describe("активность лидов (B5)", () => {
  it("touchLead ставит метку активности, activeLeads фильтрует по окну", async () => {
    const state = await StateStore.load(tmpStatePath(), 0);
    state.putLead(lead("old"));
    state.putLead(lead("fresh"));
    state.touchLead("old", 1_000);
    state.touchLead("fresh", 20_000);
    const active = state.activeLeads(21_000, 10_000);
    expect(active.map((l) => l.chatId)).toEqual(["fresh"]);
  });

  it("метка активности переживает save/load", async () => {
    const path = tmpStatePath();
    const state = await StateStore.load(path, 0);
    state.putLead(lead("42"));
    state.touchLead("42", 5_000);
    await state.save();
    const reloaded = await StateStore.load(path, 100_000);
    expect(reloaded.activeLeads(6_000, 10_000).map((l) => l.chatId)).toEqual([
      "42",
    ]);
  });

  it("legacy-лид без метки получает её временем загрузки (активен сразу, архивируется спустя окно)", async () => {
    const path = tmpStatePath();
    await writeFile(
      path,
      JSON.stringify({ leads: { "7": lead("7") } }),
      "utf8",
    );
    const loadedAt = 50 * DAY_MS;
    const state = await StateStore.load(path, loadedAt);
    // сразу после загрузки — активен
    expect(state.activeLeads(loadedAt, 30 * DAY_MS)).toHaveLength(1);
    // спустя окно без активности — архив
    expect(state.activeLeads(loadedAt + 31 * DAY_MS, 30 * DAY_MS)).toHaveLength(
      0,
    );
  });

  it("touch неизвестного chatId — no-op без ошибки", async () => {
    const state = await StateStore.load(tmpStatePath(), 0);
    expect(() => state.touchLead("nope", 1)).not.toThrow();
  });
});
