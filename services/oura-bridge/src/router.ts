import { mintIdentity } from "./identity.js";
import type { LeadRecord, StateStore } from "./state.js";
import type { BuzzApi, InboundMessage, OutboundSink } from "./types.js";

export interface RouterDeps {
  buzz: BuzzApi;
  state: StateStore;
  sink: OutboundSink;
  serviceNsec: string;
  servicePubkeyHex: string;
  operatorPubkeyHex?: string;
}

/** Имя канала: только буквы/цифры/дефисы, чтобы не спорить с валидацией relay. */
function channelName(m: InboundMessage): string {
  const safe = m.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 24);
  return `inbox-${safe || "lead"}-${m.chatId}`;
}

export class Router {
  private readonly onboarding = new Map<string, Promise<LeadRecord>>();

  constructor(private readonly deps: RouterDeps) {}

  /** Входящее из внешнего канала → сообщение лида в его комнате buzz. */
  async handleInbound(m: InboundMessage): Promise<void> {
    const lead = await this.ensureLead(m);
    await this.deps.buzz.sendMessage(lead.nsec, lead.channelId, m.text);
  }

  /** Гард от гонки: конкурентные первые сообщения одного чата ждут один онбординг. */
  private ensureLead(m: InboundMessage): Promise<LeadRecord> {
    const existing = this.deps.state.getLead(m.chatId);
    if (existing) return Promise.resolve(existing);
    const inflight = this.onboarding.get(m.chatId);
    if (inflight) return inflight;
    const p = this.onboardLead(m).finally(() => this.onboarding.delete(m.chatId));
    this.onboarding.set(m.chatId, p);
    return p;
  }

  private async onboardLead(m: InboundMessage): Promise<LeadRecord> {
    const { buzz, state, serviceNsec, operatorPubkeyHex } = this.deps;
    const id = mintIdentity();
    const channelId = await buzz.createChannel(serviceNsec, channelName(m));
    await buzz.addMember(serviceNsec, channelId, id.pubkeyHex);
    if (operatorPubkeyHex) await buzz.addMember(serviceNsec, channelId, operatorPubkeyHex);
    await buzz.trySetProfile(id.nsec, m.name);
    const lead: LeadRecord = { chatId: m.chatId, name: m.name, nsec: id.nsec, pubkeyHex: id.pubkeyHex, channelId };
    state.putLead(lead);
    await state.save();
    return lead;
  }

  /** Ответы операторов из комнат → внешний канал. markSeen только ПОСЛЕ доставки; сбой одного лида не прерывает остальных. */
  async pollOutbound(): Promise<void> {
    const { buzz, state, sink, serviceNsec, servicePubkeyHex } = this.deps;
    for (const lead of state.allLeads()) {
      try {
        const msgs = await buzz.getMessages(serviceNsec, lead.channelId, 50);
        let dirty = false;
        for (const msg of msgs) {
          if (msg.authorPubkey === lead.pubkeyHex || msg.authorPubkey === servicePubkeyHex) continue;
          if (state.hasSeen(msg.id)) continue;
          await sink.deliver({ chatId: lead.chatId, text: msg.content });
          state.markSeen(msg.id);
          dirty = true;
        }
        if (dirty) await state.save();
      } catch (e) {
        console.error(`[poll] лид ${lead.chatId}: ошибка, продолжаем со следующими:`, e);
      }
    }
  }
}
