import { useQuery } from "@tanstack/react-query";

import { useIdentityQuery } from "@/shared/api/hooks";

import type { ExternalAgentRecord } from "./externalAgent";
import { fetchExternalAgents } from "./externalAgentApi";

export const EXTERNAL_AGENTS_QUERY_KEY = "external-agents";

/** Описания внешних агентов текущего пользователя. */
export function useExternalAgentsQuery() {
  const identity = useIdentityQuery();
  const pubkey = identity.data?.pubkey ?? null;

  return useQuery<ExternalAgentRecord[]>({
    queryKey: [EXTERNAL_AGENTS_QUERY_KEY, pubkey],
    enabled: Boolean(pubkey),
    queryFn: () => (pubkey ? fetchExternalAgents(pubkey) : Promise.resolve([])),
    staleTime: 30_000,
  });
}
