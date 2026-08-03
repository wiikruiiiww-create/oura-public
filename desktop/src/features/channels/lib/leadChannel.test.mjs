import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  excludeLeadChannels,
  isLeadChannel,
  leadChannelSource,
  leadDisplayName,
  leadSourceLabel,
  selectLeadChannels,
} from "./leadChannel.ts";

function channel(overrides = {}) {
  return {
    id: "c1",
    name: "inbox-иван-42",
    channelType: "stream",
    visibility: "private",
    description: "",
    topic: "oura:lead:telegram",
    purpose: null,
    memberCount: 3,
    memberPubkeys: [],
    lastMessageAt: null,
    archivedAt: null,
    participants: [],
    participantPubkeys: [],
    isMember: true,
    ttlSeconds: null,
    ttlDeadline: null,
    ...overrides,
  };
}

describe("isLeadChannel", () => {
  it("узнаёт маркер с источником и голый префикс", () => {
    assert.equal(isLeadChannel(channel()), true);
    assert.equal(isLeadChannel(channel({ topic: "oura:lead" })), true);
    assert.equal(isLeadChannel(channel({ topic: "  oura:lead:max  " })), true);
  });

  it("не ловит обычные каналы и похожие темы", () => {
    assert.equal(isLeadChannel(channel({ topic: null })), false);
    assert.equal(isLeadChannel(channel({ topic: "" })), false);
    assert.equal(isLeadChannel(channel({ topic: "oura:leads-report" })), false);
    assert.equal(isLeadChannel(channel({ topic: "релиз 0.4.26" })), false);
  });
});

describe("leadChannelSource / leadSourceLabel", () => {
  it("достаёт источник из маркера", () => {
    assert.equal(leadChannelSource(channel()), "telegram");
    assert.equal(leadChannelSource(channel({ topic: "oura:lead" })), null);
    assert.equal(leadChannelSource(channel({ topic: "заметка" })), null);
  });

  it("подписывает известные источники и не теряет неизвестные", () => {
    assert.equal(leadSourceLabel("telegram"), "Telegram");
    assert.equal(leadSourceLabel("whatsapp"), "WhatsApp");
    assert.equal(leadSourceLabel("Telegram"), "Telegram");
    assert.equal(leadSourceLabel("carrierpigeon"), "carrierpigeon");
    assert.equal(leadSourceLabel(null), "Внешний канал");
  });
});

describe("leadDisplayName", () => {
  it("разбирает схему имени моста inbox-<имя>-<chatId>", () => {
    assert.equal(leadDisplayName("inbox-иван-42"), "Иван");
    assert.equal(leadDisplayName("inbox-anna-maria-777"), "Anna Maria");
  });

  it("безымянного лида показывает как «Клиент»", () => {
    assert.equal(leadDisplayName("inbox-lead-42"), "Клиент");
  });

  it("незнакомую форму отдаёт как есть", () => {
    assert.equal(leadDisplayName("general"), "general");
    assert.equal(leadDisplayName("inbox-42"), "inbox-42");
  });
});

describe("выборки каналов", () => {
  it("excludeLeadChannels оставляет только не-лид-каналы", () => {
    const list = [
      channel({ id: "lead" }),
      channel({ id: "general", name: "general", topic: null }),
    ];
    assert.deepEqual(
      excludeLeadChannels(list).map((c) => c.id),
      ["general"],
    );
  });

  it("selectLeadChannels отбрасывает архивные и не-членские", () => {
    const list = [
      channel({ id: "open-lead" }),
      channel({ id: "closed-lead", archivedAt: "2026-07-30T10:00:00Z" }),
      channel({ id: "foreign-lead", isMember: false }),
      channel({ id: "general", name: "general", topic: null }),
    ];
    assert.deepEqual(
      selectLeadChannels(list).map((c) => c.id),
      ["open-lead"],
    );
  });
});
