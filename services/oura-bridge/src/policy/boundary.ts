import type { KeyClass } from "./registry.js";

/**
 * Инварианты границы блоков (план ядра, Р8/Р10/Р11 + Р7 концепта).
 * Чистые функции без I/O — единственное место, где закодировано «кто где
 * может быть member» и «чьи сообщения выпускаются во внешний канал».
 * Вызывающий код (router/оркестратор) обязан спрашивать здесь, а не
 * дублировать правила по месту.
 */

/** lead_room — комната лида (topic-маркер oura:lead:*); team — внутренний блок. */
export type ChannelKind = "lead_room" | "team";

export interface MembershipQuery {
  /** класс ключа из реестра; null = незнакомый ключ (fail-closed deny) */
  actor: KeyClass | null;
  channel: ChannelKind;
  /** только для actor="lead": это его собственная комната? */
  isOwnLeadRoom: boolean;
}

export interface Decision {
  allowed: boolean;
  /** машиночитаемая причина для аудита; пустая строка при allow */
  reason: string;
}

function allow(): Decision {
  return { allowed: true, reason: "" };
}

function deny(reason: string): Decision {
  return { allowed: false, reason };
}

export function canBeMember(q: MembershipQuery): Decision {
  switch (q.actor) {
    case null:
      return deny(
        "неклассифицированный ключ — deny по умолчанию (fail-closed)",
      );
    case "service":
      return allow();
    case "operator":
      // Р7: список обращений общий на команду — операторы member лид-комнат.
      return allow();
    case "lead":
      if (q.channel === "lead_room" && q.isOwnLeadRoom) return allow();
      return deny("лид — member только собственной лид-комнаты (Р8)");
    case "external_agent":
      if (q.channel === "lead_room") return allow();
      return deny("внешний агент не ходит во внутренний блок (Р8)");
    case "internal_agent":
      if (q.channel === "team") return allow();
      return deny("внутренний агент изолирован от внешнего блока (Р10)");
  }
}

/** Чьи сообщения из лид-комнаты ретранслируются во внешний канал (Р11). */
export function canRelayOutbound(author: KeyClass | null): boolean {
  return author === "operator" || author === "external_agent";
}
