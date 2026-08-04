import { buildNip98AuthHeader } from "../buzz/nip43.js";
import {
  type ExternalAgentDef,
  KIND_MANAGED_AGENT,
  latestByAgentId,
  parseExternalAgentDef,
  type RelayEvent,
} from "./definition.js";

/**
 * Снапшот описаний внешних агентов с relay: `POST /query` (NIP-98-подпись
 * сервисным ключом) с фильтром по kind 30177, ответ фильтруется до валидных
 * внешних описаний. Ошибка сети/relay — throw: вызывающий логирует и
 * продолжает работать со старым снапшотом до следующего цикла.
 */

const DEFS_QUERY_LIMIT = 500;

export interface FetchDefsInput {
  relayUrl: string;
  serviceNsec: string;
  /** подменяется в тестах */
  fetchImpl?: typeof fetch;
  /** epoch-секунды для created_at NIP-98-события — подменяется в тестах */
  nowSec?: number;
}

/** Текущий набор описаний внешних агентов (после LWW-схлопывания). */
export async function fetchExternalAgentDefs(
  input: FetchDefsInput,
): Promise<ExternalAgentDef[]> {
  const doFetch = input.fetchImpl ?? fetch;
  const url = `${input.relayUrl.replace(/\/+$/, "")}/query`;
  const body = JSON.stringify([
    { kinds: [KIND_MANAGED_AGENT], limit: DEFS_QUERY_LIMIT },
  ]);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: buildNip98AuthHeader(
      input.serviceNsec,
      url,
      "POST",
      body,
      input.nowSec,
    ),
  };
  const res = await doFetch(url, { method: "POST", headers, body });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `запрос описаний агентов отклонён relay (HTTP ${res.status}): ${text}`,
    );
  }
  let events: unknown;
  try {
    events = JSON.parse(text);
  } catch (e) {
    throw new Error("ответ /query — не JSON", { cause: e });
  }
  if (!Array.isArray(events)) {
    throw new Error("ответ /query — не массив событий");
  }
  const defs = (events as RelayEvent[])
    .map(parseExternalAgentDef)
    .filter((d): d is ExternalAgentDef => d !== null);
  return latestByAgentId(defs);
}
