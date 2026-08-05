import { KIND_MANAGED_AGENT } from "@/shared/constants/kinds";

/**
 * Внешний агент — агент, отвечающий обращениям клиентов в комнатах лидов.
 * В отличие от внутренних, локального процесса-харнеса у него нет: описание
 * публикуется событием kind 30177 с тегом `agent-type=external`, а исполняет
 * его серверный сервис лидов.
 *
 * Схема события (контракт с сервисом лидов):
 *   ["d", <agentId>]                            — идентификатор агента
 *   ["agent-type", "external"]                  — маркер внешнего агента
 *   ["source", "telegram"]                      — тип источника обращений
 *   ["bot-token-enc", <NIP-44>, <pubkey сервиса>] — токен бота, шифрованный на
 *                                                   ключ сервиса лидов
 * content — JSON `{name, isActive, profile}`.
 *
 * Токен бота НИКОГДА не попадает в событие открытым текстом: шифруется
 * NIP-44 на pubkey сервиса лидов до сборки события.
 */

export const EXTERNAL_AGENT_TYPE = "external";
export const EXTERNAL_AGENT_SOURCE_TELEGRAM = "telegram";

export type ExternalAgentRole =
  | "sales"
  | "consultant"
  | "recruiter"
  | "support";

export type ExternalAgentFormality = "formal" | "friendly" | "casual";

export type ExternalAgentLength = "very_short" | "short" | "medium" | "long";

export interface ExternalAgentTone {
  formality: ExternalAgentFormality;
  /** максимум эмодзи на сообщение */
  maxEmojis: number;
  maxLength: ExternalAgentLength;
  language: string;
}

export interface ExternalAgentProfile {
  /** целевое действие агента — единственное обязательное поле формы */
  goal: string;
  role: ExternalAgentRole;
  tone: ExternalAgentTone;
  /** описание целевой аудитории */
  audience: string;
  /** дополнительные правила поверх базового промпта роли */
  instructions: string;
  /** справочная информация, на которую агент опирается в ответах */
  knowledge: string;
}

export interface ExternalAgentDraft {
  agentId: string;
  name: string;
  isActive: boolean;
  profile: ExternalAgentProfile;
  /** NIP-44-шифртекст токена бота */
  botTokenEnc: string;
  /** hex-pubkey сервиса лидов, на который шифрован токен */
  bridgePubkey: string;
}

export interface ExternalAgentRecord extends ExternalAgentDraft {
  /** автор события — под его ключом шифровался токен */
  ownerPubkey: string;
  createdAt: number;
  /**
   * Ключ, под которым агент пишет в комнатах обращений. Появляется, когда
   * сервис лидов его выдаст (тег `agent-pubkey`); до этого агента опознают
   * только по `agentId`.
   */
  agentPubkey?: string;
}

/** Nostr-событие в том виде, в каком его отдаёт relay. */
export interface ExternalAgentSourceEvent {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

export const EXTERNAL_AGENT_DEFAULT_PROFILE: ExternalAgentProfile = {
  goal: "",
  role: "sales",
  tone: {
    formality: "friendly",
    maxEmojis: 2,
    maxLength: "medium",
    language: "russian",
  },
  audience: "",
  instructions: "",
  knowledge: "",
};

const ROLES: ExternalAgentRole[] = [
  "sales",
  "consultant",
  "recruiter",
  "support",
];
const FORMALITIES: ExternalAgentFormality[] = ["formal", "friendly", "casual"];
const LENGTHS: ExternalAgentLength[] = [
  "very_short",
  "short",
  "medium",
  "long",
];

export interface ExternalAgentEventInput {
  kind: number;
  content: string;
  tags: string[][];
}

/** Собирает kind/tags/content для подписи и публикации описания агента. */
export function buildExternalAgentEventInput(
  draft: ExternalAgentDraft,
): ExternalAgentEventInput {
  return {
    kind: KIND_MANAGED_AGENT,
    tags: [
      ["d", draft.agentId],
      ["agent-type", EXTERNAL_AGENT_TYPE],
      ["source", EXTERNAL_AGENT_SOURCE_TELEGRAM],
      ["bot-token-enc", draft.botTokenEnc, draft.bridgePubkey],
    ],
    content: JSON.stringify({
      name: draft.name,
      isActive: draft.isActive,
      profile: draft.profile,
    }),
  };
}

function findTag(tags: string[][], name: string): string[] | undefined {
  return tags.find((tag) => tag[0] === name);
}

/** Событие описывает внешнего агента (а не локального/чужого внутреннего). */
export function isExternalAgentEvent(event: ExternalAgentSourceEvent): boolean {
  return (
    event.kind === KIND_MANAGED_AGENT &&
    findTag(event.tags, "agent-type")?.[1] === EXTERNAL_AGENT_TYPE
  );
}

function pickString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function pickEnum<T extends string>(
  value: unknown,
  allowed: T[],
  fallback: T,
): T {
  return typeof value === "string" && (allowed as string[]).includes(value)
    ? (value as T)
    : fallback;
}

function normalizeProfile(raw: unknown): ExternalAgentProfile {
  const source =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const toneSource =
    typeof source.tone === "object" &&
    source.tone !== null &&
    !Array.isArray(source.tone)
      ? (source.tone as Record<string, unknown>)
      : {};
  const defaults = EXTERNAL_AGENT_DEFAULT_PROFILE;

  return {
    goal: pickString(source.goal, defaults.goal),
    role: pickEnum(source.role, ROLES, defaults.role),
    tone: {
      formality: pickEnum(
        toneSource.formality,
        FORMALITIES,
        defaults.tone.formality,
      ),
      maxEmojis:
        typeof toneSource.maxEmojis === "number" &&
        Number.isFinite(toneSource.maxEmojis)
          ? toneSource.maxEmojis
          : defaults.tone.maxEmojis,
      maxLength: pickEnum(
        toneSource.maxLength,
        LENGTHS,
        defaults.tone.maxLength,
      ),
      language: pickString(toneSource.language, defaults.tone.language),
    },
    audience: pickString(source.audience, defaults.audience),
    instructions: pickString(source.instructions, defaults.instructions),
    knowledge: pickString(source.knowledge, defaults.knowledge),
  };
}

/**
 * Разбирает событие в описание внешнего агента; `null` для всего, что им не
 * является: другой kind, внутренний агент, неполные или битые данные.
 */
export function parseExternalAgentEvent(
  event: ExternalAgentSourceEvent,
): ExternalAgentRecord | null {
  if (!isExternalAgentEvent(event)) return null;

  const agentId = findTag(event.tags, "d")?.[1];
  if (!agentId) return null;

  if (findTag(event.tags, "source")?.[1] !== EXTERNAL_AGENT_SOURCE_TELEGRAM) {
    return null;
  }

  const tokenTag = findTag(event.tags, "bot-token-enc");
  const botTokenEnc = tokenTag?.[1];
  const bridgePubkey = tokenTag?.[2];
  if (!botTokenEnc || !bridgePubkey) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(event.content);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const content = parsed as Record<string, unknown>;

  const agentPubkey = findTag(event.tags, "agent-pubkey")?.[1];

  return {
    agentId,
    ownerPubkey: event.pubkey,
    createdAt: event.created_at,
    name: pickString(content.name, ""),
    isActive: content.isActive !== false,
    profile: normalizeProfile(content.profile),
    botTokenEnc,
    bridgePubkey,
    ...(agentPubkey ? { agentPubkey } : {}),
  };
}
