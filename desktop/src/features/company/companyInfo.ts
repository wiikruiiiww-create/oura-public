import { KIND_READ_STATE } from "@/shared/constants/kinds";

/**
 * Сведения о компании — общие для всех внешних агентов данные о бизнесе:
 * чем занимаемся, где находимся, когда работаем. Заполняются один раз в
 * настройках сообщества и подставляются в промпт каждого агента, чтобы не
 * дублировать это в базе знаний каждого из них.
 *
 * Хранятся событием NIP-78 (kind 30078) с d-тегом `oura:company`: relay такие
 * события уже принимает и не привязывает к каналу, поэтому нового kind не
 * нужно. Синхронизация позиций чтения использует тот же kind, но отбирает свои
 * события по тегам `t=read-state` / `d=read-state:*` — эти события она не
 * заденет.
 *
 * Содержимое открытое: это публичные сведения о компании, и сервис лидов
 * должен их читать.
 */

export const COMPANY_INFO_D_TAG = "oura:company";

export interface CompanyInfo {
  /** название компании */
  name: string;
  /** чем занимается бизнес */
  description: string;
  address: string;
  /** режим работы в свободной форме */
  workingHours: string;
  /** телефон, почта, сайт — в свободной форме */
  contacts: string;
}

export const EMPTY_COMPANY_INFO: CompanyInfo = {
  name: "",
  description: "",
  address: "",
  workingHours: "",
  contacts: "",
};

const FIELDS = [
  "name",
  "description",
  "address",
  "workingHours",
  "contacts",
] as const;

/** Nostr-событие в том виде, в каком его отдаёт relay. */
export interface CompanyInfoSourceEvent {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

export interface CompanyInfoEventInput {
  kind: number;
  content: string;
  tags: string[][];
}

/** Заполнено ли хоть одно поле — пустое описание публиковать незачем. */
export function hasCompanyInfo(info: CompanyInfo): boolean {
  return FIELDS.some((field) => info[field].trim().length > 0);
}

/** Собирает kind/tags/content для подписи и публикации. */
export function buildCompanyInfoEventInput(
  info: CompanyInfo,
): CompanyInfoEventInput {
  const trimmed: Record<string, string> = {};
  for (const field of FIELDS) {
    const value = info[field].trim();
    if (value) trimmed[field] = value;
  }
  return {
    kind: KIND_READ_STATE,
    tags: [["d", COMPANY_INFO_D_TAG]],
    content: JSON.stringify(trimmed),
  };
}

function dTag(event: CompanyInfoSourceEvent): string | undefined {
  return event.tags.find((tag) => tag[0] === "d")?.[1];
}

/** Событие описывает компанию (а не позицию чтения на том же kind). */
export function isCompanyInfoEvent(event: CompanyInfoSourceEvent): boolean {
  return event.kind === KIND_READ_STATE && dTag(event) === COMPANY_INFO_D_TAG;
}

/**
 * Разбирает событие в форму. Незаполненные и нестроковые поля становятся
 * пустыми строками — форма должна открываться при любом содержимом события.
 */
export function parseCompanyInfoEvent(
  event: CompanyInfoSourceEvent,
): CompanyInfo | null {
  if (!isCompanyInfoEvent(event)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.content);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const raw = parsed as Record<string, unknown>;
  const info = { ...EMPTY_COMPANY_INFO };
  for (const field of FIELDS) {
    const value = raw[field];
    if (typeof value === "string") info[field] = value;
  }
  return info;
}

/** Самая свежая редакция: править описание может любой участник команды. */
export function latestCompanyInfo(
  events: CompanyInfoSourceEvent[],
): CompanyInfo | null {
  const newest = events
    .filter(isCompanyInfoEvent)
    .sort((a, b) => b.created_at - a.created_at)[0];
  return newest ? parseCompanyInfoEvent(newest) : null;
}
