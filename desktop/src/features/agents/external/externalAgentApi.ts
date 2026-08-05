import { relayClient } from "@/shared/api/relayClient";
import { nip44EncryptToPubkey, signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";
import { KIND_MANAGED_AGENT } from "@/shared/constants/kinds";

import {
  buildExternalAgentEventInput,
  type ExternalAgentDraft,
  type ExternalAgentRecord,
  parseExternalAgentEvent,
} from "./externalAgent";

/**
 * Публикация и чтение описаний внешних агентов. Токен бота шифруется на ключ
 * сервиса лидов прямо здесь — открытым текстом он существует только в форме
 * и в памяти сервиса, но никогда на relay.
 */

export interface PublishExternalAgentInput {
  draft: Omit<ExternalAgentDraft, "botTokenEnc" | "bridgePubkey">;
  /** токен бота открытым текстом — шифруется перед публикацией */
  botToken: string;
  /** hex-ключ сервиса лидов из настроек сообщества */
  leadServicePubkey: string;
}

export async function publishExternalAgent(
  input: PublishExternalAgentInput,
): Promise<void> {
  const botTokenEnc = await nip44EncryptToPubkey(
    input.leadServicePubkey,
    input.botToken,
  );
  const eventInput = buildExternalAgentEventInput({
    ...input.draft,
    botTokenEnc,
    bridgePubkey: input.leadServicePubkey,
  });
  const event = await signRelayEvent(eventInput);
  await relayClient.publishEvent(
    event,
    "Не дождались ответа relay при сохранении агента.",
    "Не удалось сохранить агента.",
  );
}

/** Описания внешних агентов, опубликованные этим пользователем. */
export async function fetchExternalAgents(
  ownerPubkey: string,
): Promise<ExternalAgentRecord[]> {
  const events = await relayClient.fetchEvents({
    kinds: [KIND_MANAGED_AGENT],
    authors: [ownerPubkey],
    limit: 200,
  });
  return externalAgentsFromEvents(events);
}

/** Отбирает и разбирает внешние описания; чужое и битое отбрасывается. */
export function externalAgentsFromEvents(
  events: RelayEvent[],
): ExternalAgentRecord[] {
  const records: ExternalAgentRecord[] = [];
  for (const event of events) {
    const record = parseExternalAgentEvent(event);
    if (record) records.push(record);
  }
  // relay отдаёт по одной (последней) версии replaceable-события, но при
  // догонке истории дубли d-тега встречаются — оставляем самое свежее
  const latest = new Map<string, ExternalAgentRecord>();
  for (const record of records) {
    const previous = latest.get(record.agentId);
    if (!previous || record.createdAt > previous.createdAt) {
      latest.set(record.agentId, record);
    }
  }
  return [...latest.values()].sort((a, b) => b.createdAt - a.createdAt);
}
