import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCompanyInfoEventInput,
  COMPANY_INFO_D_TAG,
  EMPTY_COMPANY_INFO,
  hasCompanyInfo,
  isCompanyInfoEvent,
  latestCompanyInfo,
  parseCompanyInfoEvent,
} from "./companyInfo.ts";

const KIND = 30078;

function event(content, tags = [["d", COMPANY_INFO_D_TAG]], created_at = 100) {
  return { kind: KIND, created_at, tags, content };
}

test("пустая форма не считается заполненной", () => {
  assert.equal(hasCompanyInfo(EMPTY_COMPANY_INFO), false);
  assert.equal(hasCompanyInfo({ ...EMPTY_COMPANY_INFO, name: "   " }), false);
  assert.equal(hasCompanyInfo({ ...EMPTY_COMPANY_INFO, name: "Окна" }), true);
});

test("событие несёт d-тег компании и обрезанные поля", () => {
  const input = buildCompanyInfoEventInput({
    ...EMPTY_COMPANY_INFO,
    name: "  Окна плюс  ",
    address: "",
    contacts: "+7 999 000-00-00",
  });
  assert.equal(input.kind, KIND);
  assert.deepEqual(input.tags, [["d", COMPANY_INFO_D_TAG]]);
  assert.deepEqual(JSON.parse(input.content), {
    name: "Окна плюс",
    contacts: "+7 999 000-00-00",
  });
});

test("позиция чтения на том же kind описанием компании не считается", () => {
  assert.equal(
    isCompanyInfoEvent(event("{}", [["d", "read-state:slot-1"]])),
    false,
  );
  assert.equal(parseCompanyInfoEvent(event("{}", [["t", "read-state"]])), null);
});

test("разбор заполняет форму, недостающие поля — пустые", () => {
  const info = parseCompanyInfoEvent(
    event(JSON.stringify({ name: "Окна плюс", contacts: "+7 999" })),
  );
  assert.deepEqual(info, {
    ...EMPTY_COMPANY_INFO,
    name: "Окна плюс",
    contacts: "+7 999",
  });
});

test("нестроковые поля не попадают в форму", () => {
  const info = parseCompanyInfoEvent(
    event(JSON.stringify({ name: "Окна", address: 42 })),
  );
  assert.equal(info.name, "Окна");
  assert.equal(info.address, "");
});

test("битое содержимое не роняет разбор", () => {
  assert.equal(parseCompanyInfoEvent(event("{не json")), null);
  assert.equal(parseCompanyInfoEvent(event('["массив"]')), null);
});

test("берётся самая свежая редакция", () => {
  const info = latestCompanyInfo([
    event(JSON.stringify({ name: "Старое" }), undefined, 100),
    event(JSON.stringify({ name: "Новое" }), undefined, 200),
    event(JSON.stringify({ name: "Чужое" }), [["d", "read-state:1"]], 300),
  ]);
  assert.equal(info.name, "Новое");
});

test("описания нет — это не ошибка", () => {
  assert.equal(latestCompanyInfo([]), null);
});
