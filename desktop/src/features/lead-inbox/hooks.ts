import { useQuery } from "@tanstack/react-query";

import { getChannelPreviews } from "@/shared/api/channelPreviews";
import { useRelayConnection } from "@/shared/api/useRelayConnection";

/**
 * Превью последних сообщений комнат лидов. Ключ — отсортированный список id,
 * чтобы перестановка каналов в списке не считалась новым запросом. Фоновый
 * поллинг гасится на неподключённом relay — тем же приёмом, что useHomeFeedQuery.
 */
export function useLeadChannelPreviewsQuery(channelIds: string[]) {
  const connectionState = useRelayConnection();
  const connected = connectionState === "connected";
  const sortedIds = [...channelIds].sort();

  return useQuery({
    queryKey: ["lead-channel-previews", sortedIds],
    queryFn: () => getChannelPreviews(sortedIds),
    enabled: sortedIds.length > 0,
    staleTime: 15_000,
    gcTime: 5 * 60 * 1_000,
    refetchInterval: connected ? 30_000 : false,
  });
}
