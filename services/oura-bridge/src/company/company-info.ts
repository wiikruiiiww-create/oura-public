/**
 * Описание компании — общие для всех агентов сведения о бизнесе: чем
 * занимаемся, где находимся, когда работаем. Заполняется один раз в настройках
 * сообщества и подставляется в промпт каждого агента, чтобы не дублировать это
 * в базе знаний каждого из них.
 *
 * Хранится как NIP-78 (kind 30078) с d-тегом `oura:company`: новый kind ради
 * этого не нужен, relay такие события уже принимает. Содержимое открытое —
 * это публичные сведения о компании, и сервис лидов должен их читать.
 *
 * Редактировать может любой участник команды: берётся самая свежая редакция.
 */

import type { RelayEvent } from "../agents/definition.js";
import { buildNip98AuthHeader } from "../buzz/nip43.js";
import type { CompanyInfo } from "../engine/prompt.js";

export const COMPANY_INFO_KIND = 30078;
export const COMPANY_INFO_D_TAG = "oura:company";

/** Редакций мало, но берём с запасом: LWW-схлопывание делаем сами. */
const COMPANY_QUERY_LIMIT = 20;

const FIELDS = [
  "name",
  "description",
  "address",
  "workingHours",
  "contacts",
] as const;

function dTag(event: RelayEvent): string | null {
  const tag = event.tags.find((t) => t[0] === "d");
  return tag?.[1] ?? null;
}

/** Описание компании из события; null — если это не оно или оно пустое. */
export function parseCompanyInfoEvent(event: RelayEvent): CompanyInfo | null {
  if (dTag(event) !== COMPANY_INFO_D_TAG) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.content);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const raw = parsed as Record<string, unknown>;

  const info: CompanyInfo = {};
  for (const field of FIELDS) {
    const value = raw[field];
    if (typeof value === "string" && value.trim()) {
      info[field] = value.trim();
    }
  }
  // описание без единого заполненного поля не отличается от его отсутствия
  return Object.keys(info).length > 0 ? info : null;
}

export interface FetchCompanyInfoInput {
  relayUrl: string;
  serviceNsec: string;
  /** подменяется в тестах */
  fetchImpl?: typeof fetch;
  /** epoch-секунды для NIP-98 — подменяется в тестах */
  nowSec?: number;
}

/** Текущее описание компании с relay; null — если его ещё не заполнили. */
export async function fetchCompanyInfo(
  input: FetchCompanyInfoInput,
): Promise<CompanyInfo | null> {
  const doFetch = input.fetchImpl ?? fetch;
  const url = `${input.relayUrl.replace(/\/+$/, "")}/query`;
  // kinds обязателен: открытый фильтр relay отвергает
  const body = JSON.stringify([
    {
      kinds: [COMPANY_INFO_KIND],
      "#d": [COMPANY_INFO_D_TAG],
      limit: COMPANY_QUERY_LIMIT,
    },
  ]);
  const res = await doFetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: buildNip98AuthHeader(
        input.serviceNsec,
        url,
        "POST",
        body,
        input.nowSec,
      ),
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `запрос описания компании отклонён relay (HTTP ${res.status}): ${text}`,
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

  const newest = (events as RelayEvent[])
    .filter((e) => dTag(e) === COMPANY_INFO_D_TAG)
    .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))[0];
  return newest ? parseCompanyInfoEvent(newest) : null;
}
