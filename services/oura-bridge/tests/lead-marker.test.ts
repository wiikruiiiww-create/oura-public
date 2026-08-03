import { describe, expect, it } from "vitest";
import { LEAD_TOPIC_PREFIX, leadTopicMarker } from "../src/lead-marker.js";

describe("leadTopicMarker", () => {
  it("строит машинный маркер из источника", () => {
    expect(leadTopicMarker("telegram")).toBe("oura:lead:telegram");
    expect(LEAD_TOPIC_PREFIX).toBe("oura:lead");
  });

  it("нормализует регистр и мусорные символы", () => {
    expect(leadTopicMarker("  TeleGram ")).toBe("oura:lead:telegram");
    expect(leadTopicMarker("web-widget")).toBe("oura:lead:webwidget");
  });

  it("пустой источник даёт нейтральный external", () => {
    expect(leadTopicMarker("")).toBe("oura:lead:external");
    expect(leadTopicMarker("***")).toBe("oura:lead:external");
  });
});
