import { mintIdentity } from "./identity.js";
import type { StateStore } from "./state.js";
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
  constructor(private readonly deps: RouterDeps) {}

  /** Входящее из внешнего канала → сообщение лида в его комнате buzz. */
  async handleInbound(m: InboundMessage): Promise<void> {
    const { buzz, state, serviceNsec, operatorPubkeyHex } = this.deps;
    let lead = state.getLead(m.chatId);
    if (!lead) {
      const id = mintIdentity();
      const channelId = await buzz.createChannel(serviceNsec, channelName(m));
      await buzz.addMember(serviceNsec, channelId, id.pubkeyHex);
      if (operatorPubkeyHex) await buzz.addMember(serviceNsec, channelId, operatorPubkeyHex);
      await buzz.trySetProfile(id.nsec, m.name);
      lead = { chatId: m.chatId, name: m.name, nsec: id.nsec, pubkeyHex: id.pubkeyHex, channelId };
      state.putLead(lead);
      await state.save();
    }
    await buzz.sendMessage(lead.nsec, lead.channelId, m.text);
  }

  /** Ответы операторов из комнат → внешний канал. Фильтруем лида и сервис. */
  async pollOutbound(): Promise<void> {
    const { buzz, state, sink, serviceNsec, servicePubkeyHex } = this.deps;
    for (const lead of state.allLeads()) {
      const msgs = await buzz.getMessages(serviceNsec, lead.channelId, 50);
      let dirty = false;
      for (const msg of msgs) {
        if (msg.authorPubkey === lead.pubkeyHex || msg.authorPubkey === servicePubkeyHex) continue;
        if (state.hasSeen(msg.id)) continue;
        state.markSeen(msg.id);
        dirty = true;
        await sink.deliver({ chatId: lead.chatId, text: msg.content });
      }
      if (dirty) await state.save();
    }
  }
}
