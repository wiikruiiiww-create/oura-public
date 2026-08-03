import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WELCOME_COPY } from "./welcomeCopy.ts";

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
