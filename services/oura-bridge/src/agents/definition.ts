/**
 * Описание внешнего агента — parameterized-replaceable событие kind 30177
 * с тегом ["agent-type","external"]. Публикуется клиентом (форма «New agent»),
 * мост подхватывает его поллингом и поднимает Telegram-бота агента.
 *
 * Схема тегов (контракт с клиентом):
 *   ["d", "<agent-id>"]                       — идентификатор агента
 *   ["agent-type", "external"]                — маркер внешнего агента
 *   ["source", "telegram"]                    — тип источника лидов
 *   ["bot-token-enc", "<nip44>", "<pubkey>"]  — токен бота, шифрованный NIP-44;
 *                                               третий элемент — pubkey адресата
 *                                               шифрования (сервис моста)
 * content — JSON: { name, isActive, profile } (profile — поля формы, движок
 * ответов читает их на Этапе 3; мост провозит как есть).
 */

export const KIND_MANAGED_AGENT = 30177;

/** Событие relay в том виде, как его отдаёт `POST /query` (без sig). */
export interface RelayEvent {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

export interface ExternalAgentDef {
  agentId: string;
  /** автор события — его pubkey участвует в NIP-44-расшифровке токена */
  ownerPubkey: string;
  createdAt: number;
  name: string;
  source: "telegram";
  /** NIP-44-шифртекст токена бота */
  botTokenEnc: string;
  /** для кого шифровано — мост сверяет со своим pubkey */
  encTargetPubkey: string;
  isActive: boolean;
  /** остальные поля формы — как есть, для движка ответов */
  profile: Record<string, unknown>;
}

function tagValue(tags: string[][], name: string): string[] | undefined {
  return tags.find((t) => t[0] === name);
}

/**
 * Разбирает событие в описание внешнего агента. Возвращает null для всего,
 * что мосту не адресовано: другой kind, внутренние агенты (без
 * agent-type=external), неполные/битые события, незнакомый источник.
 */
export function parseExternalAgentDef(
  evt: RelayEvent,
): ExternalAgentDef | null {
  if (evt.kind !== KIND_MANAGED_AGENT) return null;
  if (tagValue(evt.tags, "agent-type")?.[1] !== "external") return null;

  const agentId = tagValue(evt.tags, "d")?.[1];
  if (!agentId) return null;

  if (tagValue(evt.tags, "source")?.[1] !== "telegram") return null;

  const tokenTag = tagValue(evt.tags, "bot-token-enc");
  const botTokenEnc = tokenTag?.[1];
  const encTargetPubkey = tokenTag?.[2];
  if (!botTokenEnc || !encTargetPubkey) return null;

  let content: unknown;
  try {
    content = JSON.parse(evt.content);
  } catch {
    return null;
  }
  if (typeof content !== "object" || content === null || Array.isArray(content))
    return null;
  const c = content as Record<string, unknown>;

  const profile =
    typeof c.profile === "object" &&
    c.profile !== null &&
    !Array.isArray(c.profile)
      ? (c.profile as Record<string, unknown>)
      : {};

  return {
    agentId,
    ownerPubkey: evt.pubkey,
    createdAt: evt.created_at,
    name: typeof c.name === "string" ? c.name : "",
    source: "telegram",
    botTokenEnc,
    encTargetPubkey,
    isActive: c.isActive !== false,
    profile,
  };
}

/**
 * LWW-схлопывание дублей: relay отдаёт одну (последнюю) версию replaceable-
 * события, но страховка от дублей d-тега в ответе ничего не стоит.
 */
export function latestByAgentId(defs: ExternalAgentDef[]): ExternalAgentDef[] {
  const byId = new Map<string, ExternalAgentDef>();
  for (const def of defs) {
    const prev = byId.get(def.agentId);
    if (!prev || def.createdAt > prev.createdAt) byId.set(def.agentId, def);
  }
  return [...byId.values()];
}
