import { describe, expect, it } from "vitest";
import { parseAgentReply } from "../src/engine/parser.js";

describe("разбор ответа модели", () => {
  it("теги вырезаются из текста, который увидит клиент", () => {
    const parsed = parseAgentReply(
      "Здравствуйте! Записать вас на 15:00? [STATUS:in_progress][STEP:closing]",
    );
    expect(parsed.text).toBe("Здравствуйте! Записать вас на 15:00?");
    expect(parsed.status).toBe("in_progress");
    expect(parsed.step).toBe("closing");
  });

  it("контакты клиента извлекаются в структуру", () => {
    const parsed = parseAgentReply(
      "Записал вас. [NAME:Иван][PHONE:+7 999 123-45-67][CITY:Москва][TIME:15:00]",
    );
    expect(parsed.fields).toEqual({
      name: "Иван",
      phone: "+7 999 123-45-67",
      city: "Москва",
      time: "15:00",
    });
    expect(parsed.text).toBe("Записал вас.");
  });

  it("просьба позвать человека распознаётся", () => {
    const parsed = parseAgentReply("Сейчас подключу коллегу. [NEED_HUMAN]");
    expect(parsed.needsHuman).toBe(true);
    expect(parsed.text).toBe("Сейчас подключу коллегу.");
  });

  it("сводка события читается вместе с терминальным этапом", () => {
    const parsed = parseAgentReply(
      "Готово! [STEP:order_placed][SUMMARY:Запись на стрижку 18 мая в 14:00]",
    );
    expect(parsed.step).toBe("order_placed");
    expect(parsed.summary).toBe("Запись на стрижку 18 мая в 14:00");
  });

  it("ответ без тегов остаётся как есть", () => {
    const parsed = parseAgentReply("Просто ответ без тегов");
    expect(parsed.text).toBe("Просто ответ без тегов");
    expect(parsed.status).toBeNull();
    expect(parsed.step).toBeNull();
    expect(parsed.needsHuman).toBe(false);
    expect(parsed.fields).toEqual({});
  });

  it("неизвестные теги удаляются из текста, но не ломают разбор", () => {
    const parsed = parseAgentReply("Ответ [WEIRD:что-то][STATUS:rejected]");
    expect(parsed.text).toBe("Ответ");
    expect(parsed.status).toBe("rejected");
  });

  it("незакрытые скобки не съедают ответ", () => {
    const parsed = parseAgentReply("Цена [от 1000 рублей");
    expect(parsed.text).toBe("Цена [от 1000 рублей");
  });

  it("теги в середине текста тоже вырезаются, лишние пробелы схлопываются", () => {
    const parsed = parseAgentReply("Начало [STATUS:in_progress] конец");
    expect(parsed.text).toBe("Начало конец");
  });

  it("неизвестное значение статуса игнорируется, а не подставляется вслепую", () => {
    const parsed = parseAgentReply("Ответ [STATUS:придуманный]");
    expect(parsed.status).toBeNull();
    expect(parsed.text).toBe("Ответ");
  });

  it("пустой ответ модели не превращается в пустое сообщение клиенту", () => {
    const parsed = parseAgentReply("[STATUS:in_progress]");
    expect(parsed.text).toBe("");
    expect(parsed.status).toBe("in_progress");
  });
});
