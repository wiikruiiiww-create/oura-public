import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { useCommunities } from "@/features/communities/useCommunities";

import type { AgentKind } from "./AgentKindSelector";
import { ExternalAgentDialog } from "./ExternalAgentDialog";
import type { ExternalAgentDraft } from "./externalAgent";
import { EXTERNAL_AGENTS_QUERY_KEY } from "./useExternalAgents";
import { publishExternalAgent } from "./externalAgentApi";

/**
 * Связывает форму внешнего агента с настройками сообщества и публикацией:
 * шифрует токен на ключ сервиса лидов и отправляет описание на relay.
 */
export function ExternalAgentCreateDialog({
  agentKind,
  onAgentKindChange,
  onOpenChange,
}: {
  agentKind: AgentKind;
  onAgentKindChange: (next: AgentKind) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { activeCommunity } = useCommunities();
  const queryClient = useQueryClient();
  const leadServicePubkey = activeCommunity?.leadServicePubkey ?? null;
  // id агента фиксируется на время жизни диалога: повторный сабмит после
  // сетевой ошибки должен обновить то же описание, а не создать второе
  const agentId = React.useMemo(() => crypto.randomUUID(), []);

  const publish = useMutation({
    mutationFn: async (input: {
      draft: Omit<ExternalAgentDraft, "botTokenEnc" | "bridgePubkey">;
      token: string;
    }) => {
      if (!leadServicePubkey) {
        throw new Error("В настройках сообщества не задан сервис лидов");
      }
      await publishExternalAgent({
        draft: input.draft,
        botToken: input.token,
        leadServicePubkey,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [EXTERNAL_AGENTS_QUERY_KEY],
      });
    },
  });

  return (
    <ExternalAgentDialog
      agentKind={agentKind}
      error={publish.error instanceof Error ? publish.error : null}
      isPending={publish.isPending}
      leadServicePubkey={leadServicePubkey}
      newAgentId={agentId}
      onAgentKindChange={onAgentKindChange}
      onOpenChange={onOpenChange}
      onSubmit={async (draft, token) => {
        try {
          await publish.mutateAsync({ draft, token });
          return true;
        } catch {
          // текст ошибки уже показан формой из publish.error
          return false;
        }
      }}
    />
  );
}
