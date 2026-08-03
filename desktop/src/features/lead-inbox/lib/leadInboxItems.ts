import {
  leadChannelSource,
  leadDisplayName,
  leadSourceLabel,
} from "@/features/channels/lib/leadChannel";
import type { Channel, ChannelPreview } from "@/shared/api/types";

/** Одна карточка экрана «Обращения» — одна комната лида. */
export type LeadInboxItem = {
  channelId: string;
  leadName: string;
  sourceLabel: string;
  /** Текст последнего сообщения, схлопнутый в одну строку; "" если превью нет. */
  preview: string;
  /** unix-секунды последней активности; 0 — активности нет вовсе. */
  activityAt: number;
  timestampLabel: string;
  isUnread: boolean;
  /** Ещё никто из команды не отвечал — см. компромиссы в плане. */
  isNew: boolean;
};

export type BuildLeadInboxItemsInput = {
  channels: Channel[];
  previews: ChannelPreview[];
  /** NIP-RS read-маркер канала в unix-секундах (`useAppShell().getChannelReadAt`). */
  getReadAt: (channelId: string) => number | null;
  now: Date;
  /**
   * Bump-счётчик read-state. Билдер его не читает: поле существует, чтобы
   * вызывающий useMemo честно упоминал `readStateVersion` в теле и в
   * зависимостях — `getReadAt` стабилен по ссылке и сам по себе memo не
   * инвалидирует.
   */
  readStateVersion?: number;
};

// Локальные названия месяцев вместо Intl: делают формат детерминированным в
// тестах и независимым от локали/сборки ICU.
const MONTHS_SHORT = [
  "янв",
  "фев",
  "мар",
  "апр",
  "мая",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Сегодня — «14:32», вчера — «Вчера», иначе — «2 мар» / «31 дек 2025». */
export function formatLeadTimestamp(unixSeconds: number, now: Date): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) {
    return "";
  }

  const date = new Date(unixSeconds * 1_000);
  const dayDiff = Math.round(
    (startOfDay(now).getTime() - startOfDay(date).getTime()) / 86_400_000,
  );

  if (dayDiff === 0) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  if (dayDiff === 1) {
    return "Вчера";
  }

  const label = `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear()
    ? label
    : `${label} ${date.getFullYear()}`;
}

function lastMessageAtSeconds(channel: Channel): number {
  if (!channel.lastMessageAt) {
    return 0;
  }

  const parsed = Date.parse(channel.lastMessageAt);
  return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1_000);
}

/**
 * Карточки «Обращений» из комнат лидов и батча превью. Чистая функция —
 * всё, что зависит от времени и read-state, приходит параметрами.
 */
export function buildLeadInboxItems({
  channels,
  previews,
  getReadAt,
  now,
}: BuildLeadInboxItemsInput): LeadInboxItem[] {
  const previewByChannelId = new Map(
    previews.map((preview) => [preview.channelId, preview]),
  );

  return channels
    .map((channel) => {
      const preview = previewByChannelId.get(channel.id);
      const activityAt = preview?.createdAt ?? lastMessageAtSeconds(channel);
      const readAt = getReadAt(channel.id);

      return {
        channelId: channel.id,
        leadName: leadDisplayName(channel.name),
        sourceLabel: leadSourceLabel(leadChannelSource(channel)),
        preview: preview?.content.replace(/\s+/gu, " ").trim() ?? "",
        activityAt,
        timestampLabel: formatLeadTimestamp(activityAt, now),
        isUnread: activityAt > 0 && (readAt === null || activityAt > readAt),
        // Без превью признак не вычисляем: лучше не показать бейдж, чем соврать.
        isNew: preview !== undefined && preview.authorCount <= 1,
      };
    })
    .sort(
      (left, right) =>
        right.activityAt - left.activityAt ||
        left.leadName.localeCompare(right.leadName, "ru"),
    );
}
