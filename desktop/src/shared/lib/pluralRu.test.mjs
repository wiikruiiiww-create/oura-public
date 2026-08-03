import assert from "node:assert/strict";
import { test } from "node:test";

import { pluralRu } from "./pluralRu.ts";

const FORMS = ["агент", "агента", "агентов"];

function label(n) {
  return pluralRu(n, ...FORMS);
}

test("1, 21, 101 → форма единственного числа", () => {
  assert.equal(label(1), "агент");
  assert.equal(label(21), "агент");
  assert.equal(label(101), "агент");
});

test("2–4, 22–24 → паукальная форма", () => {
  assert.equal(label(2), "агента");
  assert.equal(label(3), "агента");
  assert.equal(label(4), "агента");
  assert.equal(label(22), "агента");
  assert.equal(label(24), "агента");
});

test("0, 5–20, 25+ → форма множественного числа", () => {
  assert.equal(label(0), "агентов");
  assert.equal(label(5), "агентов");
  assert.equal(label(6), "агентов");
  assert.equal(label(10), "агентов");
  assert.equal(label(20), "агентов");
  assert.equal(label(25), "агентов");
  assert.equal(label(100), "агентов");
});

test("11–14 всегда множественное, несмотря на последнюю цифру", () => {
  assert.equal(label(11), "агентов");
  assert.equal(label(12), "агентов");
  assert.equal(label(13), "агентов");
  assert.equal(label(14), "агентов");
  assert.equal(label(111), "агентов");
  assert.equal(label(112), "агентов");
});

test("отрицательные значения используют абсолютную величину", () => {
  assert.equal(label(-1), "агент");
  assert.equal(label(-3), "агента");
  assert.equal(label(-11), "агентов");
});

test("другие ряды форм работают так же", () => {
  assert.equal(pluralRu(1, "жалоба", "жалобы", "жалоб"), "жалоба");
  assert.equal(pluralRu(2, "жалоба", "жалобы", "жалоб"), "жалобы");
  assert.equal(pluralRu(7, "жалоба", "жалобы", "жалоб"), "жалоб");
  assert.equal(pluralRu(3, "команда", "команды", "команд"), "команды");
});
