import { mintIdentity } from "./identity.js";
import type { LeadRecord, StateStore } from "./state.js";
import type { BuzzApi, InboundMessage, OutboundSink } from "./types.js";
import { PermanentDeliveryError } from "./types.js";

export interface RouterDeps {
  buzz: BuzzApi;
  state: StateStore;
  sink: OutboundSink;
  serviceNsec: string;
  servicePubkeyHex: string;
  /** hex-pubkey операторов; пусто = любой участник считается оператором (только дев-стенд) */
  operatorPubkeys: string[];
}

/** Имя канала: только буквы/цифры/дефисы, чтобы не спорить с валидацией relay. */
function channelName(m: InboundMessage): string {
  const safe = m.name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
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
    const p = this.onboardLead(m).finally(() =>
      this.onboarding.delete(m.chatId),
    );
    this.onboarding.set(m.chatId, p);
    return p;
  }

  private async onboardLead(m: InboundMessage): Promise<LeadRecord> {
    const { buzz, state, serviceNsec, operatorPubkeys } = this.deps;
    const id = mintIdentity();
    const channelId = await buzz.createChannel(serviceNsec, channelName(m));
    await buzz.addMember(serviceNsec, channelId, id.pubkeyHex);
    for (const pk of operatorPubkeys) {
      await buzz.addMember(serviceNsec, channelId, pk);
    }
    await buzz.trySetProfile(id.nsec, m.name);
    const lead: LeadRecord = {
      chatId: m.chatId,
      name: m.name,
      nsec: id.nsec,
      pubkeyHex: id.pubkeyHex,
      channelId,
    };
    state.putLead(lead);
    await state.save();
    return lead;
  }

  /**
   * Ответы операторов из комнат → внешний канал. markSeen только ПОСЛЕ доставки;
   * сбой одного лида не прерывает остальных. Seen-пометки, сделанные до сбоя
   * (в т.ч. от PermanentDeliveryError и от фильтра не-операторов), персистятся
   * через `finally` даже если следующее сообщение той же пачки бросило
   * временную ошибку — иначе они терялись бы вместе с остальным прогрессом лида.
   */
  async pollOutbound(): Promise<void> {
    const {
      buzz,
      state,
      sink,
      serviceNsec,
      servicePubkeyHex,
      operatorPubkeys,
    } = this.deps;
    for (const lead of state.allLeads()) {
      let dirty = false;
      try {
        try {
          const msgs = await buzz.getMessages(serviceNsec, lead.channelId, 50);
          for (const msg of msgs) {
            if (
              msg.authorPubkey === lead.pubkeyHex ||
              msg.authorPubkey === servicePubkeyHex
            )
              continue;
            if (
              operatorPubkeys.length > 0 &&
              !operatorPubkeys.includes(msg.authorPubkey.toLowerCase())
            ) {
              if (!state.hasSeen(lead.chatId, msg.id)) {
                console.warn(
                  `[poll] лид ${lead.chatId}: сообщение ${msg.id} от не-оператора ${msg.authorPubkey.slice(0, 8)}… не ретранслируется`,
                );
                state.markSeen(lead.chatId, msg.id);
                dirty = true;
              }
              continue;
            }
            if (state.hasSeen(lead.chatId, msg.id)) continue;
            try {
              await sink.deliver({ chatId: lead.chatId, text: msg.content });
            } catch (e) {
              if (e instanceof PermanentDeliveryError) {
                console.error(
                  `[poll] лид ${lead.chatId}: доставка невозможна (${e.message}); сообщение ${msg.id} помечено обработанным`,
                );
                state.markSeen(lead.chatId, msg.id);
                dirty = true;
                continue;
              }
              throw e; // временная ошибка → перехватится per-lead catch, повтор в следующем поллинге
            }
            state.markSeen(lead.chatId, msg.id);
            dirty = true;
          }
        } finally {
          if (dirty) await state.save();
        }
      } catch (e) {
        console.error(
          `[poll] лид ${lead.chatId}: ошибка, продолжаем со следующими:`,
          e,
        );
      }
    }
  }
}
