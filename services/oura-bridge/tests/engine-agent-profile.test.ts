import { describe, expect, it } from "vitest";
import { parseAgentProfile } from "../src/engine/agent-profile.js";

describe("профиль агента из описания", () => {
  it("читает заполненную форму как есть", () => {
    expect(
      parseAgentProfile({
        goal: "записать на замер",
        role: "consultant",
        tone: {
          formality: "formal",
          maxEmojis: 0,
          maxLength: "short",
          language: "английский",
        },
        audience: "владельцы квартир",
        instructions: "не обещать скидок",
        knowledge: "прайс",
      }),
    ).toEqual({
      goal: "записать на замер",
      role: "consultant",
      tone: {
        formality: "formal",
        maxEmojis: 0,
        maxLength: "short",
        language: "английский",
      },
      audience: "владельцы квартир",
      instructions: "не обещать скидок",
      knowledge: "прайс",
    });
  });

  it("пустое описание даёт рабочий профиль по умолчанию", () => {
    expect(parseAgentProfile(undefined)).toEqual({
      goal: "",
      role: "sales",
      tone: {
        formality: "friendly",
        maxEmojis: 1,
        maxLength: "medium",
        language: "русский",
      },
      audience: "",
      instructions: "",
      knowledge: "",
    });
  });

  it("незнакомые значения заменяются умолчаниями, а не роняют мост", () => {
    const profile = parseAgentProfile({
      goal: 42,
      role: "president",
      tone: { formality: "rude", maxLength: "epic", language: 7 },
      knowledge: null,
    });
    expect(profile.goal).toBe("");
    expect(profile.role).toBe("sales");
    expect(profile.tone.formality).toBe("friendly");
    expect(profile.tone.maxLength).toBe("medium");
    expect(profile.tone.language).toBe("русский");
    expect(profile.knowledge).toBe("");
  });

  it("количество эмодзи держится в разумных пределах", () => {
    expect(parseAgentProfile({ tone: { maxEmojis: 100 } }).tone.maxEmojis).toBe(
      5,
    );
    expect(parseAgentProfile({ tone: { maxEmojis: -3 } }).tone.maxEmojis).toBe(
      0,
    );
  });
});
