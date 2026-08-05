/**
 * Цикл работы внешнего агента: пройти по своим лидам, исполнить команды
 * комнаты, дослать одобренное, ответить на новое.
 *
 * Агент работает только со своими лидами — записями с префиксом его источника.
 * Командные каналы сюда не попадают структурно: рантайм не знает других комнат,
 * кроме тех, что мост завёл под лидов этого бота.
 */

import { deliverApprovedDrafts } from "./approval.js";
import {
  applyRoomCommands,
  handoffNotice,
  shouldHandOff,
  silenceAgent,
} from "./handoff.js";
import { ensureAgentIdentity } from "./identity.js";
import {
  AgentPipeline,
  type CompleteCall,
  type CompleteResult,
  type EngineLead,
} from "./pipeline.js";
import { postAgentReply, postServiceNotice } from "./posting.js";
import type { AgentProfile, CompanyInfo } from "./prompt.js";
import type { StateStore } from "../state.js";
import type { BuzzMessage, OutboundSink } from "../types.js";

const DEFAULT_FETCH_LIMIT = 50;
/** Префикс ключей лидов Telegram-источника — рантайм берёт только свои. */
function leadPrefix(agentId: string): string {
  return `tg:${agentId}:`;
}

export interface RuntimeAgent {
  agentId: string;
  name: string;
  profile: AgentProfile;
  isActive: boolean;
  /** общие сведения о компании — попадают в промпт каждого агента */
  company?: CompanyInfo;
}

export interface RuntimeDeps {
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
    getMessages(
      nsec: string,
      channelId: string,
      limit?: number,
    ): Promise<BuzzMessage[]>;
    trySetProfile(nsec: string, name: string): Promise<void>;
  };
  state: StateStore;
  sink: OutboundSink;
  relayUrl: string;
  serviceNsec: string;
  servicePubkeyHex: string;
  operatorPubkeys: string[];
  complete(call: CompleteCall): Promise<CompleteResult>;
  /** ответ уходит клиенту без одобрения человеком */
  autoReply?: boolean;
  /** NIP-43: регистрация ключа агента участником relay */
  registerMember?: (pubkeyHex: string) => Promise<void>;
  /** окно активности лида — вне его лид не обслуживается */
  leadActiveWindowMs?: number;
  fetchLimit?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const DEFAULT_LEAD_ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export class AgentRuntime {
  private readonly pipeline: AgentPipeline;
  private readonly now: () => number;

  constructor(private readonly deps: RuntimeDeps) {
    this.now = deps.now ?? Date.now;
    this.pipeline = new AgentPipeline({
      buzz: deps.buzz,
      state: deps.state,
      serviceNsec: deps.serviceNsec,
      servicePubkeyHex: deps.servicePubkeyHex,
      complete: deps.complete,
      fetchLimit: deps.fetchLimit,
      now: deps.now,
    });
  }

  /** Один проход по лидам агента. Сбой одного лида не мешает остальным. */
  async tick(agent: RuntimeAgent): Promise<void> {
    if (!agent.isActive) return;
    const identity = await ensureAgentIdentity(this.deps.state, agent.agentId);
    const prefix = leadPrefix(agent.agentId);
    const entries = this.deps.state
      .activeLeadEntries(
        this.now(),
        this.deps.leadActiveWindowMs ?? DEFAULT_LEAD_ACTIVE_WINDOW_MS,
      )
      .filter(({ key }) => key.startsWith(prefix));

    for (const { key, lead } of entries) {
      const engineLead: EngineLead = {
        key,
        pubkeyHex: lead.pubkeyHex,
        channelId: lead.channelId,
      };
      try {
        await this.handleLead(agent, identity, engineLead, lead.chatId);
      } catch (e) {
        console.error(
          `[движок] агент ${agent.agentId}, лид ${key}: цикл прерван, продолжаем со следующим:`,
          e,
        );
      }
    }
  }

  private async handleLead(
    agent: RuntimeAgent,
    identity: { nsec: string; pubkeyHex: string },
    lead: EngineLead,
    chatId: string,
  ): Promise<void> {
    const posting = {
      buzz: this.deps.buzz,
      state: this.deps.state,
      serviceNsec: this.deps.serviceNsec,
      registerMember: this.deps.registerMember,
      now: this.deps.now,
    };
    const postingAgent = {
      ...identity,
      agentId: agent.agentId,
      name: agent.name,
    };

    // комната читается один раз за цикл: и команды, и ответ смотрят на неё
    const messages = await this.deps.buzz.getMessages(
      this.deps.serviceNsec,
      lead.channelId,
      this.deps.fetchLimit ?? DEFAULT_FETCH_LIMIT,
    );

    await applyRoomCommands(
      {
        state: this.deps.state,
        leadKey: lead.key,
        leadPubkeyHex: lead.pubkeyHex,
        agentPubkeyHex: identity.pubkeyHex,
        servicePubkeyHex: this.deps.servicePubkeyHex,
        operatorPubkeys: this.deps.operatorPubkeys,
      },
      messages,
    );

    // сначала дошлём то, что уже одобрено: сбой связи не должен копить хвост
    await this.deliver(identity.pubkeyHex, lead, chatId);

    const outcome = await this.pipeline.run(
      { ...agent, pubkeyHex: identity.pubkeyHex },
      lead,
      messages,
    );
    if (outcome.kind !== "reply") return;

    await postAgentReply(
      posting,
      postingAgent,
      lead,
      outcome.text,
      this.deps.autoReply ? "auto" : "draft",
    );
    if (this.deps.autoReply) {
      await this.deliver(identity.pubkeyHex, lead, chatId);
    }

    if (shouldHandOff(outcome.parsed)) {
      await silenceAgent(this.deps.state, lead.key);
      await postServiceNotice(posting, lead, handoffNotice(outcome.parsed));
    }
  }

  private async deliver(
    agentPubkeyHex: string,
    lead: EngineLead,
    chatId: string,
  ): Promise<void> {
    await deliverApprovedDrafts(
      {
        state: this.deps.state,
        sink: this.deps.sink,
        relayUrl: this.deps.relayUrl,
        serviceNsec: this.deps.serviceNsec,
        fetchImpl: this.deps.fetchImpl,
        now: this.deps.now,
        autoApprove: this.deps.autoReply,
      },
      agentPubkeyHex,
      { key: lead.key, chatId, pubkeyHex: lead.pubkeyHex },
    );
  }
}
