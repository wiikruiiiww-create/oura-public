/**
 * Чистые операции над состоянием движка по лиду. Хранилище отдаёт запись,
 * эти функции считают новую — так логику заявок и окна частоты можно проверять
 * без файла на диске.
 */

import type { AgentLeadRecord, AgentUsageRecord } from "../state.js";

/**
 * Сколько id сообщений помним на лида. Список нужен только чтобы не ответить
 * дважды на одно сообщение; старые id не нужны — они давно за окном истории.
 */
export const PROCESSED_CAP = 500;

export function emptyAgentLead(): AgentLeadRecord {
  return { processedEventIds: [], replyAtMs: [] };
}

/** Отмечает сообщения взятыми в работу; хвост списка обрезается по лимиту. */
export function withProcessed(
  record: AgentLeadRecord,
  eventIds: string[],
  cap: number = PROCESSED_CAP,
): AgentLeadRecord {
  const merged = [...record.processedEventIds];
  for (const id of eventIds) {
    if (!merged.includes(id)) merged.push(id);
  }
  return {
    ...record,
    processedEventIds:
      merged.length > cap ? merged.slice(merged.length - cap) : merged,
  };
}

/** Снимает заявку — сообщения снова считаются неотвеченными. */
export function withoutProcessed(
  record: AgentLeadRecord,
  eventIds: string[],
): AgentLeadRecord {
  const drop = new Set(eventIds);
  return {
    ...record,
    processedEventIds: record.processedEventIds.filter((id) => !drop.has(id)),
  };
}

/** Записывает вызов модели, забывая вылетевшие из окна. */
export function withCall(
  record: AgentLeadRecord,
  atMs: number,
  windowMs: number,
): AgentLeadRecord {
  return {
    ...record,
    replyAtMs: [...record.replyAtMs.filter((t) => t > atMs - windowMs), atMs],
  };
}

export function callsInWindow(
  record: AgentLeadRecord,
  nowMs: number,
  windowMs: number,
): number {
  return record.replyAtMs.filter((t) => t > nowMs - windowMs).length;
}

export function addUsage(
  record: AgentUsageRecord | undefined,
  usage: { inputTokens: number; outputTokens: number },
): AgentUsageRecord {
  return {
    calls: (record?.calls ?? 0) + 1,
    inputTokens: (record?.inputTokens ?? 0) + usage.inputTokens,
    outputTokens: (record?.outputTokens ?? 0) + usage.outputTokens,
  };
}
