import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Лид-карточка — структурированное производное диалога (план ядра, этап 2).
 * Единственный источник данных «кто этот лид и что уже собрано» для
 * уведомлений handoff (этап 4) и карточек «Обращений». Сырой текст лида
 * сюда не попадает — только типизированные поля с жёсткими капами длины
 * (Р12), которые будущий sales-agent наполняет через теги пайплайна.
 *
 * Единственный писатель карточек — оркестратор (мост): sales-agent шлёт
 * события, но не пишет в этот файл напрямую (риск-решение плана §6).
 */

export const CARD_CAPS = {
  name: 120,
  source: 32,
  phone: 32,
  city: 120,
  address: 200,
  summary: 200,
  productItem: 100,
  productsCount: 20,
} as const;

export const LEAD_CARD_STATUSES = [
  "new",
  "active",
  "waiting_human",
  "resolved",
] as const;

export type LeadCardStatus = (typeof LEAD_CARD_STATUSES)[number];

export interface LeadOrderState {
  products?: string[];
  phone?: string;
  city?: string;
  address?: string;
  summary?: string;
}

export interface LeadCard {
  chatId: string;
  name: string;
  source: string;
  leadPubkey: string;
  channelId: string;
  status: LeadCardStatus;
  order?: LeadOrderState;
  updatedAt: number;
}

export interface LeadCardPatch {
  status?: LeadCardStatus;
  order?: LeadOrderState;
}

function cap(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function capOrder(order: LeadOrderState): LeadOrderState {
  const out: LeadOrderState = {};
  if (order.products !== undefined) {
    out.products = order.products
      .slice(0, CARD_CAPS.productsCount)
      .map((p) => cap(p, CARD_CAPS.productItem));
  }
  if (order.phone !== undefined) out.phone = cap(order.phone, CARD_CAPS.phone);
  if (order.city !== undefined) out.city = cap(order.city, CARD_CAPS.city);
  if (order.address !== undefined)
    out.address = cap(order.address, CARD_CAPS.address);
  if (order.summary !== undefined)
    out.summary = cap(order.summary, CARD_CAPS.summary);
  return out;
}

export function newLeadCard(
  init: {
    chatId: string;
    name: string;
    source: string;
    leadPubkey: string;
    channelId: string;
  },
  now: () => number = Date.now,
): LeadCard {
  return {
    chatId: init.chatId,
    name: cap(init.name, CARD_CAPS.name),
    source: cap(init.source, CARD_CAPS.source),
    leadPubkey: init.leadPubkey,
    channelId: init.channelId,
    status: "new",
    updatedAt: now(),
  };
}

/** Чистый мерж патча: капы применяются, частичный order не затирает собранное. */
export function applyLeadCardPatch(
  card: LeadCard,
  patch: LeadCardPatch,
  now: () => number = Date.now,
): LeadCard {
  if (
    patch.status !== undefined &&
    !LEAD_CARD_STATUSES.includes(patch.status)
  ) {
    throw new Error(`неизвестный статус карточки: "${patch.status}"`);
  }
  const next: LeadCard = { ...card, updatedAt: now() };
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.order !== undefined) {
    next.order = { ...card.order, ...capOrder(patch.order) };
  }
  return next;
}

interface CardsFile {
  cards: Record<string, LeadCard>;
}

/** JSON-файл карточек (MVP до Postgres-схемы оркестратора); атомарная запись. */
export class LeadCardStore {
  private saveChain: Promise<void> = Promise.resolve();

  private constructor(
    private readonly path: string,
    private readonly data: CardsFile,
    private readonly now: () => number,
  ) {}

  static async load(
    path: string,
    now: () => number = Date.now,
  ): Promise<LeadCardStore> {
    let data: CardsFile = { cards: {} };
    try {
      data = JSON.parse(await readFile(path, "utf8")) as CardsFile;
    } catch {
      // файла ещё нет — стартуем с пустого набора
    }
    return new LeadCardStore(path, data, now);
  }

  get(chatId: string): LeadCard | undefined {
    return this.data.cards[chatId];
  }

  all(): LeadCard[] {
    return Object.values(this.data.cards);
  }

  /** Создаёт карточку, если её нет; существующую НЕ перезатирает. */
  async upsert(init: {
    chatId: string;
    name: string;
    source: string;
    leadPubkey: string;
    channelId: string;
  }): Promise<LeadCard> {
    const existing = this.data.cards[init.chatId];
    if (existing) return existing;
    const card = newLeadCard(init, this.now);
    this.data.cards[init.chatId] = card;
    await this.save();
    return card;
  }

  async update(chatId: string, patch: LeadCardPatch): Promise<LeadCard> {
    const existing = this.data.cards[chatId];
    if (!existing) {
      throw new Error(`нет карточки для chatId "${chatId}"`);
    }
    const updated = applyLeadCardPatch(existing, patch, this.now);
    this.data.cards[chatId] = updated;
    await this.save();
    return updated;
  }

  private save(): Promise<void> {
    const next = this.saveChain.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, JSON.stringify(this.data, null, 2), "utf8");
      await rename(tmp, this.path);
    });
    this.saveChain = next.catch(() => {});
    return next;
  }
}
