/**
 * Разбор профиля агента из события описания. Событие приходит с relay и
 * собрано клиентом — на его форму полагаться нельзя: незнакомая роль, чужой
 * тип поля или отсутствующая секция не должны ронять мост. Всё, что не
 * распознано, заменяется безопасным значением по умолчанию.
 */

import type {
  AgentFormality,
  AgentLength,
  AgentProfile,
  AgentRole,
  AgentTone,
} from "./prompt.js";

const ROLES: AgentRole[] = ["sales", "consultant", "recruiter", "support"];
const FORMALITIES: AgentFormality[] = ["formal", "friendly", "casual"];
const LENGTHS: AgentLength[] = ["very_short", "short", "medium", "long"];

const DEFAULT_TONE: AgentTone = {
  formality: "friendly",
  maxEmojis: 1,
  maxLength: "medium",
  language: "русский",
};

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === "string" && (allowed as string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Эмодзи ограничиваем разумным потолком: «100 эмодзи на сообщение» — не стиль. */
function emojiCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_TONE.maxEmojis;
  }
  return Math.min(Math.max(Math.trunc(value), 0), 5);
}

function parseTone(raw: unknown): AgentTone {
  if (typeof raw !== "object" || raw === null) return DEFAULT_TONE;
  const t = raw as Record<string, unknown>;
  return {
    formality: oneOf(t.formality, FORMALITIES, DEFAULT_TONE.formality),
    maxEmojis: emojiCount(t.maxEmojis),
    maxLength: oneOf(t.maxLength, LENGTHS, DEFAULT_TONE.maxLength),
    language: str(t.language, DEFAULT_TONE.language) || DEFAULT_TONE.language,
  };
}

export function parseAgentProfile(raw: unknown): AgentProfile {
  const p =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  return {
    goal: str(p.goal),
    role: oneOf(p.role, ROLES, "sales"),
    tone: parseTone(p.tone),
    audience: str(p.audience),
    instructions: str(p.instructions),
    knowledge: str(p.knowledge),
  };
}
