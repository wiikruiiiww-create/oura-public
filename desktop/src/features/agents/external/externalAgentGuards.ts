import type { ExternalAgentRecord } from "./externalAgent";

/**
 * Внешние агенты работают только в комнатах лидов: их нельзя добавить в
 * командный канал. Гард используется и в списках кандидатов (чтобы внешний
 * там не появлялся), и на самом добавлении — UI-фильтр можно обойти, а этот
 * вызов вернёт запрет.
 */

export function isExternalAgentPubkey(
  candidate: string | null | undefined,
  externalAgents: ExternalAgentRecord[],
): boolean {
  if (!candidate) return false;
  return externalAgents.some((agent) => agent.agentId === candidate);
}

export const EXTERNAL_AGENT_CHANNEL_BLOCK_MESSAGE =
  "Внешний агент работает только в комнатах обращений — в командные каналы его добавить нельзя.";

/** Бросает, если кандидат — внешний агент; вызывается перед добавлением в канал. */
export function assertNotExternalAgent(
  candidate: string | null | undefined,
  externalAgents: ExternalAgentRecord[],
): void {
  if (isExternalAgentPubkey(candidate, externalAgents)) {
    throw new Error(EXTERNAL_AGENT_CHANNEL_BLOCK_MESSAGE);
  }
}
