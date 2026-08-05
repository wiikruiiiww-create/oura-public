/**
 * Одобрение черновика: оператор ставит на сообщение агента реакцию-палец,
 * и текст уходит клиенту. Пока реакции нет, клиент ответа не видит — это и
 * есть режим черновиков.
 *
 * Одобрять может только человек: реакции самого агента и лида игнорируются.
 * Доставленный черновик снимается из ожидания — второй раз тот же текст не
 * уйдёт, даже если реакцию поставят ещё раз.
 */

import { buildNip98AuthHeader } from "../buzz/nip43.js";
import type { PendingDraft, StateStore } from "../state.js";
import type { OutboundSink } from "../types.js";
import { PermanentDeliveryError } from "../types.js";
import { emptyAgentLead } from "./agent-state.js";

const REACTIONS_QUERY_LIMIT = 200;
const KIND_REACTION = 7;
const DEFAULT_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
/** Сколько id недоставленных черновиков помним, чтобы не пускать их в историю. */
const UNDELIVERED_CAP = 200;

/** NIP-25: «+» — базовый лайк, палец — то, что видит оператор в интерфейсе. */
const APPROVAL_CONTENT = new Set([
  "+",
  "👍",
  "👍🏻",
  "👍🏼",
  "👍🏽",
  "👍🏾",
  "👍🏿",
]);

export interface ApprovalLead {
  key: string;
  /** id чата во внешнем канале — куда доставлять одобренный текст */
  chatId: string;
  pubkeyHex: string;
}

export interface ApprovalDeps {
  state: StateStore;
  sink: OutboundSink;
  relayUrl: string;
  serviceNsec: string;
  /** подменяется в тестах */
  fetchImpl?: typeof fetch;
  /** epoch-секунды для NIP-98 — подменяется в тестах */
  nowSec?: number;
  now?: () => number;
  /** сколько ждём одобрения, прежде чем считать черновик устаревшим */
  draftTtlMs?: number;
  /**
   * Режим без одобрения: ответ агента уходит клиенту сразу. Очередь и повторы
   * при сбое связи те же, что и у черновиков, — relay о реакциях не спрашиваем.
   */
  autoApprove?: boolean;
}

interface RelayReaction {
  pubkey?: string;
  content?: string;
  tags?: string[][];
}

/** Убирает вариационные селекторы: «👍️» и «👍» — одна и та же реакция. */
function normalizeReaction(content: string): string {
  return content.trim().replace(/[︎️]/g, "");
}

function targetEventIds(reaction: RelayReaction): string[] {
  return (reaction.tags ?? [])
    .filter((t) => t[0] === "e" && typeof t[1] === "string")
    .map((t) => t[1]);
}

async function fetchReactions(
  deps: ApprovalDeps,
  eventIds: string[],
): Promise<RelayReaction[]> {
  const doFetch = deps.fetchImpl ?? fetch;
  const url = `${deps.relayUrl.replace(/\/+$/, "")}/query`;
  // kinds обязателен: открытый фильтр relay отвергает
  const body = JSON.stringify([
    { kinds: [KIND_REACTION], "#e": eventIds, limit: REACTIONS_QUERY_LIMIT },
  ]);
  const res = await doFetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: buildNip98AuthHeader(
        deps.serviceNsec,
        url,
        "POST",
        body,
        deps.nowSec,
      ),
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `запрос реакций отклонён relay (HTTP ${res.status}): ${text}`,
    );
  }
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error("ответ /query — не массив событий");
  }
  return parsed as RelayReaction[];
}

function capUndelivered(ids: string[]): string[] {
  return ids.length > UNDELIVERED_CAP
    ? ids.slice(ids.length - UNDELIVERED_CAP)
    : ids;
}

/**
 * Доставляет клиенту одобренные черновики и снимает устаревшие.
 * Возвращает то, что реально ушло клиенту.
 */
export async function deliverApprovedDrafts(
  deps: ApprovalDeps,
  agentPubkeyHex: string,
  lead: ApprovalLead,
): Promise<PendingDraft[]> {
  const now = (deps.now ?? Date.now)();
  const ttl = deps.draftTtlMs ?? DEFAULT_DRAFT_TTL_MS;
  const record = deps.state.getAgentLead(lead.key) ?? emptyAgentLead();
  const all = record.pendingDrafts ?? [];
  if (all.length === 0) return [];

  const expired = all.filter((d) => d.createdAtMs <= now - ttl);
  let pending = all.filter((d) => d.createdAtMs > now - ttl);
  let undelivered = [
    ...(record.undeliveredDraftEventIds ?? []),
    ...expired.map((d) => d.eventId),
  ];

  const delivered: PendingDraft[] = [];
  if (pending.length > 0) {
    const approved = new Set<string>();
    if (deps.autoApprove) {
      for (const d of pending) approved.add(d.eventId);
    } else {
      const reactions = await fetchReactions(
        deps,
        pending.map((d) => d.eventId),
      );
      for (const r of reactions) {
        const author = (r.pubkey ?? "").toLowerCase();
        // одобряет человек: реакции агента и самого клиента не считаются
        if (author === agentPubkeyHex.toLowerCase()) continue;
        if (author === lead.pubkeyHex.toLowerCase()) continue;
        if (!APPROVAL_CONTENT.has(normalizeReaction(r.content ?? ""))) continue;
        for (const id of targetEventIds(r)) approved.add(id);
      }
    }

    const keep: PendingDraft[] = [];
    let stopped = false;
    for (const draft of pending) {
      if (stopped || !approved.has(draft.eventId)) {
        keep.push(draft);
        continue;
      }
      try {
        await deps.sink.deliver({ chatId: lead.chatId, text: draft.text });
        // снят из ожидания и НЕ помечен недоставленным: клиент это увидел,
        // значит реплика становится частью истории диалога
        delivered.push(draft);
      } catch (e) {
        if (e instanceof PermanentDeliveryError) {
          console.error(
            `[движок] лид ${lead.key}: черновик ${draft.eventId} доставить невозможно (${e.message})`,
          );
          undelivered.push(draft.eventId);
          continue;
        }
        console.error(
          `[движок] лид ${lead.key}: доставка черновика ${draft.eventId} отложена:`,
          e,
        );
        keep.push(draft);
        stopped = true; // канал недоступен — остальные тоже ждут
      }
    }
    pending = keep;
  }

  undelivered = capUndelivered(undelivered);
  deps.state.putAgentLead(lead.key, {
    ...(deps.state.getAgentLead(lead.key) ?? record),
    pendingDrafts: pending,
    undeliveredDraftEventIds: undelivered,
  });
  await deps.state.save();
  return delivered;
}
