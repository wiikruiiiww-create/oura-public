/**
 * Ключ внешнего агента. Агент пишет в комнаты лидов своим ключом, а не
 * сервисным: операторы должны видеть, где реплика агента, а где служебное
 * сообщение моста, и мост по этому же ключу отличает свои сообщения от чужих.
 *
 * Ключ минтится один раз и живёт в файле состояния рядом с ключами лидов.
 */

import { mintIdentity } from "../identity.js";
import type { AgentKeyRecord, StateStore } from "../state.js";

/** Возвращает ключ агента, заводя его при первом обращении. */
export async function ensureAgentIdentity(
  state: StateStore,
  agentId: string,
): Promise<AgentKeyRecord> {
  const existing = state.getAgentKey(agentId);
  if (existing) return existing;
  const minted = mintIdentity();
  state.putAgentKey(agentId, minted);
  await state.save();
  return minted;
}
