/**
 * Агент пишет в комнату лида: вход в комнату и публикация черновика ответа.
 *
 * Черновик — обычное сообщение под ключом агента с подсказкой в первой строке:
 * оператор видит предложенный текст и одобряет его реакцией. Клиенту уходит
 * только чистый текст, поэтому он хранится отдельно от того, что видно в
 * комнате. Мост черновики лиду не ретранслирует — до одобрения их не существует.
 */

import type { AgentKeyRecord, PendingDraft, StateStore } from "../state.js";
import { emptyAgentLead } from "./agent-state.js";
import type { EngineLead } from "./pipeline.js";

/** Первая строка черновика — инструкция оператору, что с ним делать. */
export const DRAFT_HINT =
  "🤖 Черновик ответа. Поставьте 👍, чтобы отправить клиенту.";

export interface PostingAgent extends AgentKeyRecord {
  agentId: string;
  name: string;
}

export interface PostingDeps {
  buzz: {
    addMember(
      nsec: string,
      channelId: string,
      pubkeyHex: string,
    ): Promise<void>;
    sendMessage(
      nsec: string,
      channelId: string,
      content: string,
    ): Promise<string | null>;
    trySetProfile(nsec: string, name: string): Promise<void>;
  };
  state: StateStore;
  serviceNsec: string;
  /** NIP-43: регистрация ключа агента участником relay перед первым событием */
  registerMember?: (pubkeyHex: string) => Promise<void>;
  now?: () => number;
}

export function wrapDraft(text: string): string {
  return `${DRAFT_HINT}\n\n${text}`;
}

/**
 * Снимает подсказку с одобренного черновика. В истории диалога должна остаться
 * реплика агента, а не обращённая к оператору служебная строка.
 */
export function stripDraftHint(content: string): string {
  return content.startsWith(DRAFT_HINT)
    ? content.slice(DRAFT_HINT.length).trimStart()
    : content;
}

/** Добавляет агента в комнату лида; повторные вызовы бесплатны. */
export async function ensureAgentInRoom(
  deps: PostingDeps,
  agent: PostingAgent,
  lead: EngineLead,
): Promise<void> {
  const record = deps.state.getAgentLead(lead.key) ?? emptyAgentLead();
  if (record.agentInRoom) return;

  // регистрация до добавления: без членства в relay событие агента отвергнут
  if (deps.registerMember) await deps.registerMember(agent.pubkeyHex);
  await deps.buzz.addMember(deps.serviceNsec, lead.channelId, agent.pubkeyHex);
  await deps.buzz.trySetProfile(agent.nsec, agent.name);

  // отметка ставится только после успеха — иначе сбой relay навсегда оставил бы
  // агента вне комнаты, а мост считал бы, что он вошёл
  deps.state.putAgentLead(lead.key, {
    ...(deps.state.getAgentLead(lead.key) ?? record),
    agentInRoom: true,
  });
  await deps.state.save();
}

/** Публикует черновик и запоминает его до одобрения оператором. */
export async function postDraft(
  deps: PostingDeps,
  agent: PostingAgent,
  lead: EngineLead,
  text: string,
): Promise<PendingDraft> {
  await ensureAgentInRoom(deps, agent, lead);
  const eventId = await deps.buzz.sendMessage(
    agent.nsec,
    lead.channelId,
    wrapDraft(text),
  );
  if (!eventId) {
    throw new Error(
      "relay не вернул id события черновика — одобрить такой черновик реакцией невозможно",
    );
  }
  const draft: PendingDraft = {
    eventId,
    text,
    createdAtMs: (deps.now ?? Date.now)(),
  };
  const record = deps.state.getAgentLead(lead.key) ?? emptyAgentLead();
  // предыдущий черновик отменяется: разговор ушёл вперёд, и одобрение старого
  // отправило бы клиенту ответ на уже неактуальный вопрос
  const superseded = (record.pendingDrafts ?? []).map((d) => d.eventId);
  deps.state.putAgentLead(lead.key, {
    ...record,
    pendingDrafts: [draft],
    undeliveredDraftEventIds: [
      ...(record.undeliveredDraftEventIds ?? []),
      ...superseded,
    ],
  });
  await deps.state.save();
  return draft;
}

/** Публикует сообщение агента в комнату как есть (режим без одобрения). */
export async function postAsAgent(
  deps: PostingDeps,
  agent: PostingAgent,
  lead: EngineLead,
  text: string,
): Promise<string | null> {
  await ensureAgentInRoom(deps, agent, lead);
  return deps.buzz.sendMessage(agent.nsec, lead.channelId, text);
}
