/**
 * Передача диалога человеку. Агент уступает, когда клиент прямо просит живого
 * сотрудника или когда разговор дошёл до конца воронки — дальше нужен человек,
 * а не ещё одна реплика бота.
 *
 * Уйдя из диалога, агент молчит, пока оператор не вернёт его командой в
 * комнате. Управлять агентом может только команда: клиент, написавший
 * «/agent on» в мессенджере, ничего не включит.
 */

import type { StateStore } from "../state.js";
import type { BuzzMessage } from "../types.js";
import { emptyAgentLead } from "./agent-state.js";
import type { ParsedReply, ReplyStep } from "./parser.js";

/** Команда возврата агента в диалог — её показываем команде в уведомлении. */
export const RESUME_COMMAND = "/agent on";
const PAUSE_COMMAND = "/agent off";

/** Сколько id исполненных команд помним, чтобы не выполнить их повторно. */
const HANDLED_COMMANDS_CAP = 100;

/** Шаги, после которых диалог ведёт человек. */
const TERMINAL_STEPS: ReadonlySet<ReplyStep> = new Set<ReplyStep>([
  "order_placed",
  "goal_completed",
]);

export type RoomCommand = "on" | "off";

export function shouldHandOff(parsed: ParsedReply): boolean {
  return (
    parsed.needsHuman ||
    (parsed.step !== null && TERMINAL_STEPS.has(parsed.step))
  );
}

/** Сообщение команде в комнату о том, что дальше диалог за людьми. */
export function handoffNotice(parsed: ParsedReply): string {
  const reason = parsed.needsHuman
    ? "Клиент попросил связать его с человеком."
    : "Агент довёл диалог до конца сценария.";
  const summary = parsed.summary ? `\nИтог: ${parsed.summary}` : "";
  return `🙋 Диалог передан команде. ${reason}${summary}\nАгент молчит; чтобы вернуть его в диалог, отправьте в этой комнате «${RESUME_COMMAND}».`;
}

/**
 * Команда управления агентом. Распознаётся только когда занимает всё
 * сообщение: упоминание команды внутри фразы её не запускает.
 */
export function parseRoomCommand(content: string): RoomCommand | null {
  const normalized = content.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized === RESUME_COMMAND) return "on";
  if (normalized === PAUSE_COMMAND) return "off";
  return null;
}

export interface RoomCommandDeps {
  state: StateStore;
  leadKey: string;
  leadPubkeyHex: string;
  agentPubkeyHex: string;
  servicePubkeyHex: string;
  /** пусто = любой участник комнаты считается оператором (только дев-стенд) */
  operatorPubkeys: string[];
}

function isOperator(deps: RoomCommandDeps, pubkey: string): boolean {
  const pk = pubkey.toLowerCase();
  if (pk === deps.leadPubkeyHex.toLowerCase()) return false;
  if (pk === deps.agentPubkeyHex.toLowerCase()) return false;
  if (pk === deps.servicePubkeyHex.toLowerCase()) return false;
  if (deps.operatorPubkeys.length === 0) return true;
  return deps.operatorPubkeys.includes(pk);
}

/**
 * Исполняет новые команды из комнаты и возвращает актуальное состояние
 * молчания. Однажды исполненная команда не срабатывает второй раз — иначе
 * старое «/agent on» отменяло бы каждую следующую передачу диалога человеку.
 */
export async function applyRoomCommands(
  deps: RoomCommandDeps,
  messages: BuzzMessage[],
): Promise<boolean> {
  const record = deps.state.getAgentLead(deps.leadKey) ?? emptyAgentLead();
  const handled = new Set(record.handledCommandEventIds ?? []);

  const fresh = [...messages]
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .filter((m) => !handled.has(m.id) && isOperator(deps, m.authorPubkey))
    .map((m) => ({ id: m.id, command: parseRoomCommand(m.content) }))
    .filter(
      (c): c is { id: string; command: RoomCommand } => c.command !== null,
    );

  if (fresh.length === 0) return record.silenced === true;

  const silenced = fresh[fresh.length - 1].command === "off";
  const ids = [
    ...(record.handledCommandEventIds ?? []),
    ...fresh.map((c) => c.id),
  ];
  deps.state.putAgentLead(deps.leadKey, {
    ...record,
    silenced,
    handledCommandEventIds:
      ids.length > HANDLED_COMMANDS_CAP
        ? ids.slice(ids.length - HANDLED_COMMANDS_CAP)
        : ids,
  });
  await deps.state.save();
  return silenced;
}

/** Уводит агента из диалога после передачи человеку. */
export async function silenceAgent(
  state: StateStore,
  leadKey: string,
): Promise<void> {
  const record = state.getAgentLead(leadKey) ?? emptyAgentLead();
  state.putAgentLead(leadKey, { ...record, silenced: true });
  await state.save();
}
