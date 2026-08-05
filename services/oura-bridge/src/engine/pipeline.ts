/**
 * Ядро ответа внешнего агента: из комнаты лида берутся неотвеченные сообщения,
 * собирается история, вызывается модель, ответ разбирается на текст и служебные
 * пометки. Постингом занимается вызывающий — здесь только решение «что ответить».
 *
 * Два правила определяют форму модуля:
 *
 * 1. На одно сообщение клиента — ровно один ответ. Вызов модели занимает
 *    секунды, а поллинг успевает прийти повторно, поэтому сообщения берутся в
 *    работу (и сохраняются) ДО вызова, а при сбое модели заявка снимается —
 *    иначе сообщение клиента осталось бы без ответа навсегда.
 * 2. Пока клиент пишет очередь сообщений, отвечать на каждое отдельно не нужно:
 *    все неотвеченные склеиваются в одно обращение.
 */

import type { StateStore } from "../state.js";
import type { BuzzMessage } from "../types.js";
import {
  addUsage,
  callsInWindow,
  emptyAgentLead,
  withCall,
  withoutProcessed,
  withProcessed,
} from "./agent-state.js";
import type { HistoryTurn } from "./llm.js";
import { parseAgentReply, type ParsedReply } from "./parser.js";
import { stripDraftHint } from "./posting.js";
import {
  buildSystemPrompt,
  type AgentProfile,
  type CompanyInfo,
} from "./prompt.js";

const DEFAULT_HISTORY_WINDOW = 20;
const DEFAULT_FETCH_LIMIT = 50;
const DEFAULT_RATE_LIMIT = { maxCalls: 5, windowMs: 60_000 };

export interface EngineAgent {
  agentId: string;
  name: string;
  /** ключ, под которым агент пишет в комнату — его реплики становятся историей */
  pubkeyHex: string;
  profile: AgentProfile;
}

export interface EngineLead {
  /** ключ записи лида в state (с префиксом источника) */
  key: string;
  pubkeyHex: string;
  channelId: string;
}

/** Запрос к модели, собранный пайплайном. */
export interface CompleteCall {
  systemPrompt: string;
  history: HistoryTurn[];
  userMessage: string;
}

export interface CompleteResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
}

export type SkipReason =
  | "no_new_messages"
  | "in_flight"
  | "rate_limited"
  | "llm_error";

export type PipelineOutcome =
  | { kind: "skip"; reason: SkipReason }
  | {
      kind: "reply";
      /** текст для клиента — служебные теги уже вырезаны */
      text: string;
      parsed: ParsedReply;
      consumedEventIds: string[];
    };

export interface PipelineDeps {
  buzz: {
    getMessages(
      nsec: string,
      channelId: string,
      limit?: number,
    ): Promise<BuzzMessage[]>;
  };
  state: StateStore;
  serviceNsec: string;
  /** сообщения сервисного ключа — служебные, в диалог не входят */
  servicePubkeyHex: string;
  complete(call: CompleteCall): Promise<CompleteResult>;
  company?: CompanyInfo;
  historyWindow?: number;
  fetchLimit?: number;
  rateLimit?: { maxCalls: number; windowMs: number };
  now?: () => number;
}

function skip(reason: SkipReason): PipelineOutcome {
  return { kind: "skip", reason };
}

/** Хронологический порядок; id — устойчивый разрыв ничьей при равных метках. */
function chronological(messages: BuzzMessage[]): BuzzMessage[] {
  return [...messages].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
}

export class AgentPipeline {
  /** лиды, по которым прямо сейчас идёт вызов модели в этом процессе */
  private readonly inFlight = new Set<string>();
  private readonly now: () => number;
  private readonly historyWindow: number;
  private readonly fetchLimit: number;
  private readonly rateLimit: { maxCalls: number; windowMs: number };

  constructor(private readonly deps: PipelineDeps) {
    this.now = deps.now ?? Date.now;
    this.historyWindow = deps.historyWindow ?? DEFAULT_HISTORY_WINDOW;
    this.fetchLimit = deps.fetchLimit ?? DEFAULT_FETCH_LIMIT;
    this.rateLimit = deps.rateLimit ?? DEFAULT_RATE_LIMIT;
  }

  async run(agent: EngineAgent, lead: EngineLead): Promise<PipelineOutcome> {
    if (this.inFlight.has(lead.key)) return skip("in_flight");
    this.inFlight.add(lead.key);
    try {
      return await this.runExclusive(agent, lead);
    } finally {
      this.inFlight.delete(lead.key);
    }
  }

  private async runExclusive(
    agent: EngineAgent,
    lead: EngineLead,
  ): Promise<PipelineOutcome> {
    const { state } = this.deps;
    const record = state.getAgentLead(lead.key) ?? emptyAgentLead();

    const messages = chronological(
      await this.deps.buzz.getMessages(
        this.deps.serviceNsec,
        lead.channelId,
        this.fetchLimit,
      ),
    );

    const processed = new Set(record.processedEventIds);
    const firstNewIndex = messages.findIndex(
      (m) => m.authorPubkey === lead.pubkeyHex && !processed.has(m.id),
    );
    if (firstNewIndex === -1) return skip("no_new_messages");

    const now = this.now();
    if (
      callsInWindow(record, now, this.rateLimit.windowMs) >=
      this.rateLimit.maxCalls
    ) {
      return skip("rate_limited");
    }

    const fresh = messages
      .slice(firstNewIndex)
      .filter((m) => m.authorPubkey === lead.pubkeyHex && !processed.has(m.id));
    const consumedEventIds = fresh.map((m) => m.id);

    // заявка сохраняется ДО вызова модели: следующий поллинг увидит эти
    // сообщения обработанными и не отправит второй ответ
    state.putAgentLead(lead.key, withProcessed(record, consumedEventIds));
    await state.save();

    let result: CompleteResult;
    try {
      result = await this.deps.complete({
        systemPrompt: buildSystemPrompt({
          name: agent.name,
          profile: agent.profile,
          company: this.deps.company,
        }),
        history: this.history(messages.slice(0, firstNewIndex), lead),
        userMessage: fresh.map((m) => m.content).join("\n"),
      });
    } catch (e) {
      console.error(
        `[движок] агент ${agent.agentId}, лид ${lead.key}: модель не ответила, заявка снята:`,
        e,
      );
      const current = state.getAgentLead(lead.key) ?? emptyAgentLead();
      state.putAgentLead(lead.key, withoutProcessed(current, consumedEventIds));
      await state.save();
      return skip("llm_error");
    }

    const claimed = state.getAgentLead(lead.key) ?? emptyAgentLead();
    state.putAgentLead(
      lead.key,
      withCall(claimed, now, this.rateLimit.windowMs),
    );
    state.putAgentUsage(
      agent.agentId,
      addUsage(state.getAgentUsage(agent.agentId), result.usage),
    );
    await state.save();

    const parsed = parseAgentReply(result.text);
    return { kind: "reply", text: parsed.text, parsed, consumedEventIds };
  }

  /**
   * Диалог, каким его видел клиент: его реплики и то, что ему отвечали.
   * Служебные сообщения сервисного ключа и черновики, до клиента не дошедшие,
   * в историю не попадают — иначе агент считал бы их уже сказанными.
   */
  private history(earlier: BuzzMessage[], lead: EngineLead): HistoryTurn[] {
    const record = this.deps.state.getAgentLead(lead.key);
    const unseenByLead = new Set([
      ...(record?.pendingDrafts ?? []).map((d) => d.eventId),
      ...(record?.undeliveredDraftEventIds ?? []),
    ]);
    const turns: HistoryTurn[] = [];
    for (const m of earlier) {
      if (m.authorPubkey === this.deps.servicePubkeyHex) continue;
      if (unseenByLead.has(m.id)) continue;
      const isLead = m.authorPubkey === lead.pubkeyHex;
      const content = isLead ? m.content : stripDraftHint(m.content);
      if (!content.trim()) continue;
      turns.push({ role: isLead ? "user" : "assistant", content });
    }
    return turns.slice(-this.historyWindow);
  }
}
