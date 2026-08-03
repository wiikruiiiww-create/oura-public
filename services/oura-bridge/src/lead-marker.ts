/**
 * Machine-маркер лид-канала, который мост пишет в поле `topic` канала
 * (kind 9002 → relay синтезирует его в kind:39000). Десктоп распознаёт
 * «Обращения» и прячет лид-каналы из сайдбара именно по префиксу.
 *
 * ВАЖНО: тот же префикс независимо объявлен на фронте в
 * `desktop/src/features/channels/lib/leadChannel.ts` — пакеты не делят код,
 * менять нужно в обоих местах одновременно.
 *
 * Почему `topic`, а не `channel_type`: `channel_type` — закрытый enum
 * (Postgres enum + buzz-core + валидация relay), новый вариант потребовал бы
 * миграции и кросс-крейтового патча. `topic` relay отдаёт как произвольную
 * строку, а команда `buzz channels topic` уже существует.
 */
export const LEAD_TOPIC_PREFIX = "oura:lead";

/** `telegram` → `oura:lead:telegram`. Источник нормализуется до [a-z0-9]. */
export function leadTopicMarker(source: string): string {
  const safe = source
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return `${LEAD_TOPIC_PREFIX}:${safe || "external"}`;
}
