import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { unreadCountLabel } from "./UnreadPill.tsx";

describe("unreadCountLabel", () => {
  it("1 — единственное число", () => {
    assert.equal(unreadCountLabel(1), "1 новое сообщение");
  });

  it("2–4 — паукальная форма", () => {
    assert.equal(unreadCountLabel(2), "2 новых сообщения");
    assert.equal(unreadCountLabel(4), "4 новых сообщения");
  });

  it("5+, 11–14 и составные — правильные формы", () => {
    assert.equal(unreadCountLabel(5), "5 новых сообщений");
    assert.equal(unreadCountLabel(11), "11 новых сообщений");
    assert.equal(unreadCountLabel(14), "14 новых сообщений");
    assert.equal(unreadCountLabel(21), "21 новое сообщение");
    assert.equal(unreadCountLabel(100), "100 новых сообщений");
  });
});
