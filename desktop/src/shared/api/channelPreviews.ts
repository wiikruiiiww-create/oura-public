import { invokeTauri } from "@/shared/api/tauri";
import type { ChannelPreview } from "@/shared/api/types";

type RawChannelPreview = {
  channel_id: string;
  event_id: string;
  pubkey: string;
  content: string;
  created_at: number;
  author_count: number;
};

/**
 * Батч-превью последнего сообщения по списку комнат. Один relay-запрос на весь
 * экран «Обращений»; известное ограничение выборки описано в
 * `desktop/src-tauri/src/commands/channel_previews.rs`.
 */
export async function getChannelPreviews(
  channelIds: string[],
): Promise<ChannelPreview[]> {
  if (channelIds.length === 0) {
    return [];
  }

  const raw = await invokeTauri<RawChannelPreview[]>("get_channel_previews", {
    channelIds,
  });

  return raw.map((item) => ({
    channelId: item.channel_id,
    eventId: item.event_id,
    pubkey: item.pubkey,
    content: item.content,
    createdAt: item.created_at,
    authorCount: item.author_count,
  }));
}
