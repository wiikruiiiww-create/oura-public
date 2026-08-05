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
  /** окно активности лида (B5): вне окна лид не поллится; дефолт 30 дней */
  leadActiveWindowMs?: number;
  /** источник времени — подменяется в тестах */
  now?: () => number;
  /**
   * NIP-43 (этап 2Б): регистрация лид-ключа участником relay при онбординге,
   * ДО первого события от имени лида. Не задано = регистрация выключена
   * (relay без membership-гейта).
   */
  registerLeadMembership?: (leadPubkeyHex: string) => Promise<void>;
  /**
   * Префикс ключей лидов в state (мульти-бот). Не задан/пуст — легаси-режим:
   * ключ = сырой chatId, роутер видит только записи без префикса источника.
   * Роутер источника получает `sourceLeadKeyPrefix(agentId)` и видит только
   * своих лидов — один человек в двух ботах не смешивается в одну комнату.
   */
  leadKeyPrefix?: string;
  /**
   * Ключ внешнего агента этого источника. Его сообщения — черновики и реплики
   * движка — роутер клиенту не ретранслирует: черновик до одобрения клиенту не
   * предназначен, а одобренный текст доставляет сам движок.
   */
  agentPubkeyHex?: string;
}

const DEFAULT_LEAD_ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Пространство ключей источников; легаси-роутер такие записи не трогает. */
const SOURCE_KEY_NAMESPACE = "tg:";

/** Префикс ключей лидов для бота внешнего агента. */
export function sourceLeadKeyPrefix(agentId: string): string {
  return `${SOURCE_KEY_NAMESPACE}${agentId}:`;
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
  private readonly now: () => number;
  private readonly leadActiveWindowMs: number;
  private readonly prefix: string;

  constructor(private readonly deps: RouterDeps) {
    this.now = deps.now ?? Date.now;
    this.leadActiveWindowMs =
      deps.leadActiveWindowMs ?? DEFAULT_LEAD_ACTIVE_WINDOW_MS;
    this.prefix = deps.leadKeyPrefix ?? "";
  }

  /** Ключ записи лида в state для этого роутера. */
  private leadKey(chatId: string): string {
    return `${this.prefix}${chatId}`;
  }

  /**
   * Принадлежит ли ключ state этому роутеру. Легаси-роутер (prefix "")
   * обязан игнорировать записи источников — иначе, стартуя первым, он
   * захватил бы их лидов и ответы ушли бы через чужого бота.
   */
  private ownsKey(key: string): boolean {
    if (this.prefix === "") return !key.startsWith(SOURCE_KEY_NAMESPACE);
    return key.startsWith(this.prefix);
  }

  /**
   * Входящее из внешнего канала → сообщение лида в его комнате buzz.
   * Активность отмечается до отправки: лид написал нам, значит должен
   * поллиться, даже если эта конкретная отправка в relay сорвалась.
   */
  async handleInbound(m: InboundMessage): Promise<void> {
    const lead = await this.ensureLead(m);
    this.deps.state.touchLead(this.leadKey(m.chatId), this.now());
    await this.deps.state.save();
    await this.deps.buzz.sendMessage(lead.nsec, lead.channelId, m.text);
  }

  /** Гард от гонки: конкурентные первые сообщения одного чата ждут один онбординг. */
  private ensureLead(m: InboundMessage): Promise<LeadRecord> {
    const key = this.leadKey(m.chatId);
    const existing = this.deps.state.getLead(key);
    if (existing) return Promise.resolve(existing);
    const inflight = this.onboarding.get(key);
    if (inflight) return inflight;
    const p = this.onboardLead(m).finally(() => this.onboarding.delete(key));
    this.onboarding.set(key, p);
    return p;
  }

  private async onboardLead(m: InboundMessage): Promise<LeadRecord> {
    const { buzz, state, serviceNsec, operatorPubkeys } = this.deps;
    const id = mintIdentity();
    // сбой регистрации валит онбординг целиком — лид не сохраняется,
    // следующее его сообщение повторит попытку с нуля
    if (this.deps.registerLeadMembership) {
      await this.deps.registerLeadMembership(id.pubkeyHex);
    }
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
    // в записи — сырой chatId (нужен для доставки в Telegram), ключ — с префиксом
    state.putLead(lead, this.leadKey(m.chatId));
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
    const activeEntries = state
      .activeLeadEntries(this.now(), this.leadActiveWindowMs)
      .filter(({ key }) => this.ownsKey(key));
    for (const { key, lead } of activeEntries) {
      let dirty = false;
      try {
        try {
          const msgs = await buzz.getMessages(serviceNsec, lead.channelId, 50);
          for (const msg of msgs) {
            if (
              msg.authorPubkey === lead.pubkeyHex ||
              msg.authorPubkey === servicePubkeyHex ||
              msg.authorPubkey === this.deps.agentPubkeyHex
            )
              continue;
            if (
              operatorPubkeys.length > 0 &&
              !operatorPubkeys.includes(msg.authorPubkey.toLowerCase())
            ) {
              if (!state.hasSeen(key, msg.id)) {
                console.warn(
                  `[poll] лид ${lead.chatId}: сообщение ${msg.id} от не-оператора ${msg.authorPubkey.slice(0, 8)}… не ретранслируется`,
                );
                state.markSeen(key, msg.id);
                dirty = true;
              }
              continue;
            }
            if (state.hasSeen(key, msg.id)) continue;
            try {
              await sink.deliver({ chatId: lead.chatId, text: msg.content });
            } catch (e) {
              if (e instanceof PermanentDeliveryError) {
                console.error(
                  `[poll] лид ${lead.chatId}: доставка невозможна (${e.message}); сообщение ${msg.id} помечено обработанным`,
                );
                state.markSeen(key, msg.id);
                dirty = true;
                continue;
              }
              throw e; // временная ошибка → перехватится per-lead catch, повтор в следующем поллинге
            }
            state.markSeen(key, msg.id);
            // доставленный ответ оператора продлевает окно активности лида
            state.touchLead(key, this.now());
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
