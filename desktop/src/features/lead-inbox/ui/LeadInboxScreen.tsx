import * as React from "react";

import { useAppShell } from "@/app/AppShellContext";
import { useChannelsQuery } from "@/features/channels/hooks";
import { selectLeadChannels } from "@/features/channels/lib/leadChannel";
import { useLeadChannelPreviewsQuery } from "@/features/lead-inbox/hooks";
import { buildLeadInboxItems } from "@/features/lead-inbox/lib/leadInboxItems";
import { LeadInboxListPane } from "@/features/lead-inbox/ui/LeadInboxListPane";
import {
  isRelayUnreachableError,
  RELAY_UNREACHABLE_MESSAGE,
} from "@/shared/lib/relayError";

type LeadInboxScreenProps = {
  onOpenChannel: (channelId: string) => void;
};

function errorMessageFor(error: unknown): string | undefined {
  if (error === null || error === undefined) {
    return undefined;
  }
  if (isRelayUnreachableError(error)) {
    return RELAY_UNREACHABLE_MESSAGE;
  }
  return error instanceof Error ? error.message : undefined;
}

/**
 * Экран «Обращения»: внешние диалоги, заведённые мостом oura-bridge. Источник —
 * тот же `useChannelsQuery`, что и у сайдбара, отфильтрованный до комнат лидов,
 * плюс батч превью последних сообщений.
 */
export function LeadInboxScreen({ onOpenChannel }: LeadInboxScreenProps) {
  const channelsQuery = useChannelsQuery();
  const { getChannelReadAt, readStateVersion } = useAppShell();

  const leadChannels = React.useMemo(
    () => selectLeadChannels(channelsQuery.data ?? []),
    [channelsQuery.data],
  );
  const channelIds = React.useMemo(
    () => leadChannels.map((channel) => channel.id),
    [leadChannels],
  );
  const previewsQuery = useLeadChannelPreviewsQuery(channelIds);

  const items = React.useMemo(
    () =>
      buildLeadInboxItems({
        channels: leadChannels,
        previews: previewsQuery.data ?? [],
        getReadAt: getChannelReadAt,
        now: new Date(),
        readStateVersion,
      }),
    [leadChannels, previewsQuery.data, getChannelReadAt, readStateVersion],
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <LeadInboxListPane
        errorMessage={errorMessageFor(
          channelsQuery.error ?? previewsQuery.error,
        )}
        isLoading={channelsQuery.isLoading || previewsQuery.isLoading}
        items={items}
        onOpenChannel={onOpenChannel}
      />
    </div>
  );
}
