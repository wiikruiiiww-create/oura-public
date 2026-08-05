import { describe, expect, it } from "vitest";
import { buildSystemPrompt, type AgentProfile } from "../src/engine/prompt.js";

const baseProfile: AgentProfile = {
  goal: "Записать на консультацию",
  role: "sales",
  tone: {
    formality: "friendly",
    maxEmojis: 2,
    maxLength: "medium",
    language: "russian",
  },
  audience: "",
  instructions: "",
  knowledge: "",
};

describe("системный промпт внешнего агента", () => {
  it("роль задаёт воронку и профессию агента", () => {
    const prompt = buildSystemPrompt({ name: "Аня", profile: baseProfile });
    expect(prompt).toContain("менеджер по продажам");
    expect(prompt).toContain("ВОРОНКА");
    expect(prompt).toContain("Тебя зовут Аня");
    expect(prompt).toContain("Записать на консультацию");
  });

  it("каждая роль даёт свой базовый промпт", () => {
    const roles = ["sales", "consultant", "recruiter", "support"] as const;
    const prompts = roles.map((role) =>
      buildSystemPrompt({ name: "", profile: { ...baseProfile, role } }),
    );
    expect(new Set(prompts).size).toBe(roles.length);
    expect(prompts[3]).toContain("поддержк");
  });

  it("жёсткие правила присутствуют всегда: не выдумывать и не звать человека без просьбы", () => {
    const prompt = buildSystemPrompt({ name: "", profile: baseProfile });
    expect(prompt).toContain("НЕ ВЫДУМЫВАЙ");
    expect(prompt).toContain("[NEED_HUMAN]");
    expect(prompt).toMatch(/ТОЛЬКО если клиент .*просит/i);
  });

  it("стиль общения переводится в конкретные указания", () => {
    const formal = buildSystemPrompt({
      name: "",
      profile: {
        ...baseProfile,
        tone: {
          ...baseProfile.tone,
          formality: "formal",
          maxEmojis: 0,
          maxLength: "very_short",
        },
      },
    });
    expect(formal).toContain("на Вы");
    expect(formal).toContain("не более 0");
    expect(formal).toMatch(/1 предложение/i);
  });

  it("пустые поля не создают пустых секций", () => {
    const prompt = buildSystemPrompt({ name: "", profile: baseProfile });
    expect(prompt).not.toContain("ЦЕЛЕВАЯ АУДИТОРИЯ");
    expect(prompt).not.toContain("БАЗА ЗНАНИЙ");
    expect(prompt).not.toContain("ТВОЁ ИМЯ");
  });

  it("заполненные поля попадают в промпт", () => {
    const prompt = buildSystemPrompt({
      name: "",
      profile: {
        ...baseProfile,
        audience: "Малый бизнес",
        instructions: "Не обещай скидок",
        knowledge: "Работаем с 9 до 18",
      },
    });
    expect(prompt).toContain("Малый бизнес");
    expect(prompt).toContain("Не обещай скидок");
    expect(prompt).toContain("Работаем с 9 до 18");
  });

  it("информация о компании подставляется, когда задана", () => {
    const prompt = buildSystemPrompt({
      name: "",
      profile: baseProfile,
      company: { name: "OURA", description: "Платформа для команд" },
    });
    expect(prompt).toContain("OURA");
    expect(prompt).toContain("Платформа для команд");
  });

  it("длинные поля обрезаются, чтобы не раздувать контекст", () => {
    const huge = "и".repeat(50_000);
    const prompt = buildSystemPrompt({
      name: "",
      profile: {
        ...baseProfile,
        knowledge: huge,
        instructions: huge,
        audience: huge,
      },
    });
    expect(prompt.length).toBeLessThan(60_000);
    expect(prompt).toContain("обрезан");
  });

  it("блок тегов объясняет модели протокол ответа", () => {
    const prompt = buildSystemPrompt({ name: "", profile: baseProfile });
    expect(prompt).toContain("[STATUS:");
    expect(prompt).toContain("[STEP:");
    expect(prompt).toContain("[SUMMARY:");
    expect(prompt).toContain("[PHONE:");
  });
});
