import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resultIcon } from "./SearchResultItem.tsx";

const channel = (channelType) => ({
  kind: "channel",
  channel: { id: "c1", name: "Продажи", channelType },
});

describe("resultIcon", () => {
  it("обычный канал — без иконки (решётка удалена)", () => {
    assert.equal(resultIcon(channel("stream"), new Map()), null);
  });

  it("форум и личные сохраняют свои иконки", () => {
    assert.notEqual(resultIcon(channel("forum"), new Map()), null);
    assert.notEqual(resultIcon(channel("dm"), new Map()), null);
  });
});
