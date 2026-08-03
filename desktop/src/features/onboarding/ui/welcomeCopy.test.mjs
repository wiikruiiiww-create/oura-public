import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { IDENTITY_KEY_HELP_COPY, WELCOME_COPY } from "./welcomeCopy.ts";

describe("WELCOME_COPY", () => {
  it("вордмарк — oura строчными", () => {
    assert.equal(WELCOME_COPY.wordmark, "oura");
  });

  it("слоган на русском", () => {
    assert.equal(
      WELCOME_COPY.tagline,
      "Люди, Агенты, Коммуникации — все в одном месте",
    );
  });

  it("кнопки и футер на русском", () => {
    assert.equal(WELCOME_COPY.createKey, "Создать новый ключ");
    assert.equal(WELCOME_COPY.creatingKey, "Сохраняем ключ…");
    assert.equal(WELCOME_COPY.useExistingKey, "Войти с существующим ключом");
    assert.equal(WELCOME_COPY.whatIsKey, "Что такое ключ идентичности?");
  });
});

describe("IDENTITY_KEY_HELP_COPY", () => {
  it("заголовок повторяет ссылку-триггер", () => {
    assert.equal(IDENTITY_KEY_HELP_COPY.title, WELCOME_COPY.whatIsKey);
  });

  it("текст на русском, про OURA и без упоминаний Buzz", () => {
    assert.equal(IDENTITY_KEY_HELP_COPY.paragraphs.length, 3);
    for (const paragraph of IDENTITY_KEY_HELP_COPY.paragraphs) {
      assert.doesNotMatch(paragraph, /buzz/i);
    }
    assert.match(IDENTITY_KEY_HELP_COPY.paragraphs[0], /OURA/);
  });
});
