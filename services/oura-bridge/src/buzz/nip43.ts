import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import * as nip19 from "nostr-tools/nip19";
import { finalizeEvent, type VerifiedEvent } from "nostr-tools/pure";
import { normalizePubkeyHex } from "../identity.js";

/**
 * NIP-43: регистрация лид-ключа участником relay (этап 2Б). Сервисный ключ
 * (должен быть admin/owner relay) публикует kind:9030 с p-тегом лида через
 * HTTP `POST /events` c NIP-98-аутентификацией. Повторная регистрация уже
 * существующего участника — no-op на стороне relay. Без этой регистрации
 * включение BUZZ_REQUIRE_RELAY_MEMBERSHIP=true отрезает лидов от relay.
 */

const RELAY_ADMIN_ADD_MEMBER = 9030;
const HTTP_AUTH = 27235;

function decodeNsec(nsec: string): Uint8Array {
  const decoded = nip19.decode(nsec);
  if (decoded.type !== "nsec") {
    throw new Error("serviceNsec не является nsec-ключом");
  }
  return decoded.data;
}

function nowSecDefault(): number {
  return Math.floor(Date.now() / 1000);
}

/** Подписанное сервисным ключом kind:9030 «добавить участника relay». */
export function buildRelayAddMemberEvent(
  serviceNsec: string,
  leadPubkeyHex: string,
  createdAtSec: number = nowSecDefault(),
): VerifiedEvent {
  const pk = normalizePubkeyHex(leadPubkeyHex);
  if (!pk) {
    throw new Error(`невалидный pubkey лида: "${leadPubkeyHex}"`);
  }
  return finalizeEvent(
    {
      kind: RELAY_ADMIN_ADD_MEMBER,
      created_at: createdAtSec,
      tags: [["p", pk]],
      content: "",
    },
    decodeNsec(serviceNsec),
  );
}

/** Значение заголовка Authorization по NIP-98 (kind:27235, теги u/method/payload). */
export function buildNip98AuthHeader(
  serviceNsec: string,
  url: string,
  method: string,
  body: string,
  createdAtSec: number = nowSecDefault(),
): string {
  const payloadHex = bytesToHex(sha256(new TextEncoder().encode(body)));
  const event = finalizeEvent(
    {
      kind: HTTP_AUTH,
      created_at: createdAtSec,
      tags: [
        ["u", url],
        ["method", method],
        ["payload", payloadHex],
      ],
      content: "",
    },
    decodeNsec(serviceNsec),
  );
  const b64 = Buffer.from(JSON.stringify(event), "utf8").toString("base64");
  return `Nostr ${b64}`;
}

export interface RegisterRelayMemberInput {
  relayUrl: string;
  serviceNsec: string;
  leadPubkeyHex: string;
  /** подменяется в тестах */
  fetchImpl?: typeof fetch;
  /** epoch-секунды для created_at — подменяется в тестах */
  nowSec?: number;
}

/** Регистрирует лид-ключ участником relay; бросает, если relay отверг событие. */
export async function registerRelayMember(
  input: RegisterRelayMemberInput,
): Promise<void> {
  const doFetch = input.fetchImpl ?? fetch;
  const createdAt = input.nowSec ?? nowSecDefault();
  const url = `${input.relayUrl.replace(/\/+$/, "")}/events`;
  const event = buildRelayAddMemberEvent(
    input.serviceNsec,
    input.leadPubkeyHex,
    createdAt,
  );
  const body = JSON.stringify(event);
  const res = await doFetch(url, {
    method: "POST",
    headers: {
      authorization: buildNip98AuthHeader(
        input.serviceNsec,
        url,
        "POST",
        body,
        createdAt,
      ),
      "content-type": "application/json",
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `регистрация лид-ключа отклонена relay (HTTP ${res.status}): ${text}`,
    );
  }
  let accepted = false;
  try {
    accepted = (JSON.parse(text) as { accepted?: boolean }).accepted === true;
  } catch {
    // не-JSON ответ трактуем как отказ
  }
  if (!accepted) {
    throw new Error(`регистрация лид-ключа не принята relay: ${text}`);
  }
}
