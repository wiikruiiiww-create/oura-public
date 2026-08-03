import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildLeadInboxItems, formatLeadTimestamp } from "./leadInboxItems.ts";

function seconds(year, month, day, hour = 12, minute = 0) {
  return Math.floor(new Date(year, month, day, hour, minute).getTime() / 1000);
}

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

function preview(overrides = {}) {
  return {
    channelId: "c1",
    eventId: "e1",
    pubkey: "lead",
    content: "Здравствуйте!",
    createdAt: seconds(2026, 6, 15, 14, 32),
    authorCount: 1,
    ...overrides,
  };
}

describe("formatLeadTimestamp", () => {
  const now = new Date(2026, 6, 15, 18, 0);

  it("сегодня — часы:минуты", () => {
    assert.equal(formatLeadTimestamp(seconds(2026, 6, 15, 9, 5), now), "09:05");
    assert.equal(
      formatLeadTimestamp(seconds(2026, 6, 15, 14, 32), now),
      "14:32",
    );
  });

  it("вчера — «Вчера»", () => {
    assert.equal(
      formatLeadTimestamp(seconds(2026, 6, 14, 23, 59), now),
      "Вчера",
    );
  });

  it("в этом году — день и месяц", () => {
    assert.equal(formatLeadTimestamp(seconds(2026, 2, 2, 8, 0), now), "2 мар");
  });

  it("в прошлом году — с годом", () => {
    assert.equal(
      formatLeadTimestamp(seconds(2025, 11, 31, 8, 0), now),
      "31 дек 2025",
    );
  });

  it("отсутствующая активность — пустая метка", () => {
    assert.equal(formatLeadTimestamp(0, now), "");
  });
});

describe("buildLeadInboxItems", () => {
  const now = new Date(2026, 6, 15, 18, 0);

  it("собирает карточку из канала и превью", () => {
    const [item] = buildLeadInboxItems({
      channels: [channel()],
      previews: [preview()],
      getReadAt: () => null,
      now,
    });
    assert.equal(item.channelId, "c1");
    assert.equal(item.leadName, "Иван");
    assert.equal(item.sourceLabel, "Telegram");
    assert.equal(item.preview, "Здравствуйте!");
    assert.equal(item.timestampLabel, "14:32");
    assert.equal(item.isUnread, true);
    assert.equal(item.isNew, true);
  });

  it("схлопывает переносы строк в превью", () => {
    const [item] = buildLeadInboxItems({
      channels: [channel()],
      previews: [preview({ content: "  первая\n\nвторая  " })],
      getReadAt: () => null,
      now,
    });
    assert.equal(item.preview, "первая вторая");
  });

  it("несколько авторов — обращение уже не новое", () => {
    const [item] = buildLeadInboxItems({
      channels: [channel()],
      previews: [preview({ authorCount: 2 })],
      getReadAt: () => null,
      now,
    });
    assert.equal(item.isNew, false);
  });

  it("read-маркер новее последнего сообщения снимает непрочитанное", () => {
    const at = seconds(2026, 6, 15, 14, 32);
    const [item] = buildLeadInboxItems({
      channels: [channel()],
      previews: [preview({ createdAt: at })],
      getReadAt: () => at + 1,
      now,
    });
    assert.equal(item.isUnread, false);
  });

  it("канал без превью не падает: время из lastMessageAt, бейджа «новый» нет", () => {
    const [item] = buildLeadInboxItems({
      channels: [
        channel({ lastMessageAt: new Date(2026, 6, 14, 10, 0).toISOString() }),
      ],
      previews: [],
      getReadAt: () => null,
      now,
    });
    assert.equal(item.preview, "");
    assert.equal(item.timestampLabel, "Вчера");
    assert.equal(item.isNew, false);
    assert.equal(item.isUnread, true);
  });

  it("канал совсем без активности не считается непрочитанным", () => {
    const [item] = buildLeadInboxItems({
      channels: [channel()],
      previews: [],
      getReadAt: () => null,
      now,
    });
    assert.equal(item.activityAt, 0);
    assert.equal(item.timestampLabel, "");
    assert.equal(item.isUnread, false);
  });

  it("сортирует по свежести, ничью — по имени лида", () => {
    const at = seconds(2026, 6, 15, 10, 0);
    const items = buildLeadInboxItems({
      channels: [
        channel({ id: "old", name: "inbox-борис-1" }),
        channel({ id: "new", name: "inbox-анна-2" }),
        channel({ id: "tie", name: "inbox-виктор-3" }),
      ],
      previews: [
        preview({ channelId: "old", createdAt: at - 100 }),
        preview({ channelId: "new", createdAt: at }),
        preview({ channelId: "tie", createdAt: at }),
      ],
      getReadAt: () => null,
      now,
    });
    assert.deepEqual(
      items.map((item) => item.channelId),
      ["new", "tie", "old"],
    );
  });
});
