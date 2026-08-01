import { describe, expect, it } from "vitest";
import type { InboundMessage } from "../src/types.js";

describe("каркас пакета", () => {
  it("типы импортируются, объект соответствует InboundMessage", () => {
    const m: InboundMessage = { chatId: "42", name: "Иван", text: "привет" };
    expect(m.chatId).toBe("42");
  });
});
