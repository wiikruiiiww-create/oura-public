import type { Channel } from "@/shared/api/types";

/**
 * Machine-маркер комнаты лида в поле `topic` (kind:39000). Ставится мостом
 * `services/oura-bridge` командой `buzz channels topic` сразу после создания
 * канала — см. `services/oura-bridge/src/lead-marker.ts`, где тот же префикс
 * объявлен независимо (пакеты не делят код: менять надо в обоих местах).
 *
 * Формат: `oura:lead:<source>`, например `oura:lead:telegram`.
 */
export const LEAD_TOPIC_PREFIX = "oura:lead";

type LeadChannelLike = Pick<Channel, "topic">;

/** Комната внешнего диалога («Обращение»), а не обычный канал команды. */
export function isLeadChannel(channel: LeadChannelLike): boolean {
  const topic = channel.topic?.trim() ?? "";
  return (
    topic === LEAD_TOPIC_PREFIX || topic.startsWith(`${LEAD_TOPIC_PREFIX}:`)
  );
}

/** `oura:lead:telegram` → `telegram`; голый префикс и не-лид → `null`. */
export function leadChannelSource(channel: LeadChannelLike): string | null {
  if (!isLeadChannel(channel)) {
    return null;
  }

  const topic = channel.topic?.trim() ?? "";
  const source = topic.slice(LEAD_TOPIC_PREFIX.length + 1).trim();
  return source.length > 0 ? source : null;
}

const SOURCE_LABELS: Record<string, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  max: "MAX",
  widget: "Виджет",
  email: "Email",
};

/** Подпись источника на карточке. Неизвестный источник показываем как есть. */
export function leadSourceLabel(source: string | null): string {
  if (!source) {
    return "Внешний канал";
  }

  return SOURCE_LABELS[source.toLowerCase()] ?? source;
}

/**
 * Имя лида из имени канала. Мост строит его как `inbox-<safe-name>-<chatId>`
 * (`services/oura-bridge/src/router.ts::channelName`), где safe-name — нижний
 * регистр без пунктуации, а `lead` — заглушка для пустого имени. Разбор
 * best-effort: незнакомую форму возвращаем как есть.
 */
export function leadDisplayName(channelName: string): string {
  const trimmed = channelName.trim();
  const match = /^inbox-(.+)-([^-]+)$/u.exec(trimmed);
  if (!match) {
    return trimmed;
  }

  const raw = match[1];
  if (raw === "lead") {
    return "Клиент";
  }

  return raw
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Каналы для обычных списков (сайдбар): комнаты лидов туда не попадают. */
export function excludeLeadChannels<T extends LeadChannelLike>(
  channels: T[],
): T[] {
  return channels.filter((channel) => !isLeadChannel(channel));
}

/**
 * Комнаты лидов для экрана «Обращения». Архивные не показываем: архив канала —
 * это и есть «обращение закрыто» в v1 (отдельного статус-примитива нет).
 */
export function selectLeadChannels(channels: Channel[]): Channel[] {
  return channels.filter(
    (channel) =>
      isLeadChannel(channel) && channel.archivedAt === null && channel.isMember,
  );
}
