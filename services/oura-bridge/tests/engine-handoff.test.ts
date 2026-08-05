import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyRoomCommands,
  handoffNotice,
  parseRoomCommand,
  RESUME_COMMAND,
  shouldHandOff,
} from "../src/engine/handoff.js";
import { parseAgentReply } from "../src/engine/parser.js";
import { StateStore } from "../src/state.js";
import type { BuzzMessage } from "../src/types.js";

const LEAD_KEY = "tg:agent-1:42";
const LEAD_PK = "1ead".padEnd(64, "0");
const AGENT_PK = "a9e7".padEnd(64, "0");
const SERVICE_PK = "5e12".padEnd(64, "0");
const OPERATOR_PK = "0f11".padEnd(64, "0");

let state: StateStore;

function msg(
  id: string,
  authorPubkey: string,
  content: string,
  createdAt: number,
): BuzzMessage {
  return { id, authorPubkey, content, createdAt };
}

function commandDeps(operatorPubkeys: string[] = [OPERATOR_PK]) {
  return {
    state,
    leadKey: LEAD_KEY,
    leadPubkeyHex: LEAD_PK,
    agentPubkeyHex: AGENT_PK,
    servicePubkeyHex: SERVICE_PK,
    operatorPubkeys,
  };
}

beforeEach(async () => {
  state = await StateStore.load(
    join(mkdtempSync(join(tmpdir(), "oura-handoff-")), "s.json"),
  );
});

describe("когда агент уступает человеку", () => {
  it("клиент попросил живого сотрудника", () => {
    expect(shouldHandOff(parseAgentReply("Секунду [NEED_HUMAN]"))).toBe(true);
  });

  it("заказ оформлен", () => {
    expect(
      shouldHandOff(
        parseAgentReply("Готово [STEP:order_placed][SUMMARY:Заказ]"),
      ),
    ).toBe(true);
  });

  it("цель достигнута", () => {
    expect(
      shouldHandOff(parseAgentReply("Записал [STEP:goal_completed]")),
    ).toBe(true);
  });

  it("обычная реплика диалог не передаёт", () => {
    expect(
      shouldHandOff(parseAgentReply("Расскажу подробнее [STEP:closing]")),
    ).toBe(false);
  });
});

describe("сообщение команде", () => {
  it("содержит итог и способ вернуть агента", () => {
    const notice = handoffNotice(
      parseAgentReply("Готово [STEP:order_placed][SUMMARY:Заказ на 2 окна]"),
    );
    expect(notice).toContain("Заказ на 2 окна");
    expect(notice).toContain(RESUME_COMMAND);
  });

  it("без итога остаётся понятным", () => {
    const notice = handoffNotice(parseAgentReply("Секунду [NEED_HUMAN]"));
    expect(notice).toContain("человек");
    expect(notice).toContain(RESUME_COMMAND);
  });
});

describe("команды в комнате", () => {
  it("распознаёт включение и выключение агента", () => {
    expect(parseRoomCommand("/agent on")).toBe("on");
    expect(parseRoomCommand("  /Agent OFF  ")).toBe("off");
    expect(parseRoomCommand("а давайте /agent on")).toBeNull();
    expect(parseRoomCommand("обычное сообщение")).toBeNull();
  });

  it("оператор возвращает агента в диалог", async () => {
    state.putAgentLead(LEAD_KEY, {
      processedEventIds: [],
      replyAtMs: [],
      silenced: true,
    });
    const silenced = await applyRoomCommands(commandDeps(), [
      msg("c1", OPERATOR_PK, "/agent on", 10),
    ]);
    expect(silenced).toBe(false);
    expect(state.getAgentLead(LEAD_KEY)?.silenced).toBe(false);
  });

  it("оператор может увести агента из диалога вручную", async () => {
    const silenced = await applyRoomCommands(commandDeps(), [
      msg("c1", OPERATOR_PK, "/agent off", 10),
    ]);
    expect(silenced).toBe(true);
  });

  it("применяется последняя команда", async () => {
    const silenced = await applyRoomCommands(commandDeps(), [
      msg("c1", OPERATOR_PK, "/agent off", 10),
      msg("c2", OPERATOR_PK, "/agent on", 11),
    ]);
    expect(silenced).toBe(false);
  });

  it("клиент управлять агентом не может", async () => {
    state.putAgentLead(LEAD_KEY, {
      processedEventIds: [],
      replyAtMs: [],
      silenced: true,
    });
    const silenced = await applyRoomCommands(commandDeps(), [
      msg("c1", LEAD_PK, "/agent on", 10),
    ]);
    expect(silenced).toBe(true);
  });

  it("посторонний участник управлять агентом не может", async () => {
    state.putAgentLead(LEAD_KEY, {
      processedEventIds: [],
      replyAtMs: [],
      silenced: true,
    });
    const silenced = await applyRoomCommands(commandDeps(), [
      msg("c1", "beef".padEnd(64, "0"), "/agent on", 10),
    ]);
    expect(silenced).toBe(true);
  });

  it("исполненная команда повторно не срабатывает", async () => {
    const messages = [msg("c1", OPERATOR_PK, "/agent on", 10)];
    await applyRoomCommands(commandDeps(), messages);
    // агент ушёл из диалога уже ПОСЛЕ команды
    const record = state.getAgentLead(LEAD_KEY);
    if (record) state.putAgentLead(LEAD_KEY, { ...record, silenced: true });
    const silenced = await applyRoomCommands(commandDeps(), messages);
    expect(silenced).toBe(true);
  });
});
