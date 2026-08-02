import { schnorr } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import * as nip19 from "nostr-tools/nip19";
import { getPublicKey } from "nostr-tools/pure";
import { normalizePubkeyHex } from "../identity.js";

/**
 * NIP-OA (docs/nips/NIP-OA.md): аттестация «этот agent-ключ принадлежит
 * owner-ключу». Не событие, а тег, который агент несёт на СВОИХ событиях:
 *
 *   ["auth", "<owner-pubkey-hex>", "<conditions>", "<sig-hex>"]
 *
 * Подпись владельца: BIP-340 Schnorr над SHA256("nostr:agent-auth:" ||
 * agent_pubkey || ":" || conditions). Relay материализует связь
 * first-write-wins в users.agent_owner_pubkey.
 *
 * В ядре OURA владелец — сервисный ключ платформы, агенты — лид-идентичности
 * (концепт, маппинг «Лид»). Тег доставляется через env BUZZ_AUTH_TAG:
 * buzz-cli сам инжектит его во все подписываемые события лида.
 */

const DOMAIN_SEPARATOR = "nostr:agent-auth:";
const SIG_HEX_RE = /^[0-9a-f]{128}$/;
const MAX_KIND = 65535;
const MAX_TIMESTAMP = 4294967295;

export type AuthTag = [
  tag: "auth",
  ownerPubkeyHex: string,
  conditions: string,
  sigHex: string,
];

/**
 * Валидация грамматики <conditions> по спеке: пустая строка ИЛИ клаузы
 * `kind=<n>` / `created_at<t>` / `created_at>t` через одиночные `&`;
 * канонические десятичные без ведущих нулей, без пробелов.
 */
export function validateConditions(conditions: string): void {
  if (conditions === "") return;
  for (const clause of conditions.split("&")) {
    const m = /^(kind=|created_at<|created_at>)(0|[1-9][0-9]*)$/.exec(clause);
    if (!m) {
      throw new Error(`невалидная клауза conditions: "${clause}"`);
    }
    const value = Number(m[2]);
    const max = m[1] === "kind=" ? MAX_KIND : MAX_TIMESTAMP;
    if (value > max) {
      throw new Error(`значение вне диапазона в клаузе "${clause}"`);
    }
  }
}

/** SHA256 прообраза подписи, hex — вынесено для сверки с тест-векторами спеки. */
export function computePreimageDigestHex(
  agentPubkeyHex: string,
  conditions: string,
): string {
  const preimage = `${DOMAIN_SEPARATOR}${agentPubkeyHex}:${conditions}`;
  return bytesToHex(sha256(new TextEncoder().encode(preimage)));
}

/** Выпуск аттестации владельцем (сервисным ключом) для agent-ключа (лида). */
export function computeAuthTag(input: {
  ownerNsec: string;
  agentPubkeyHex: string;
  /** по умолчанию "" — без ограничений на kind/время */
  conditions?: string;
}): AuthTag {
  const agentPk = normalizePubkeyHex(input.agentPubkeyHex);
  if (!agentPk) {
    throw new Error(`невалидный agent-pubkey: "${input.agentPubkeyHex}"`);
  }
  const conditions = input.conditions ?? "";
  validateConditions(conditions);

  const decoded = nip19.decode(input.ownerNsec);
  if (decoded.type !== "nsec") {
    throw new Error("ownerNsec не является nsec-ключом");
  }
  const ownerSecret = decoded.data;
  const ownerPk = getPublicKey(ownerSecret);
  if (ownerPk === agentPk) {
    throw new Error("самоаттестация запрещена (owner == agent, спека NIP-OA)");
  }

  const digest = computePreimageDigestHex(agentPk, conditions);
  const sig = bytesToHex(schnorr.sign(digest, ownerSecret));
  return ["auth", ownerPk, conditions, sig];
}

/**
 * Полная проверка тега против agent-pubkey. Возвращает owner-pubkey.
 * Бросает на любом нарушении спеки (форма, грамматика, самоаттестация,
 * криптоподпись) — вызывающий код не должен различать причины мягко.
 */
export function verifyAuthTag(tag: unknown, agentPubkeyHex: string): string {
  const agentPk = normalizePubkeyHex(agentPubkeyHex);
  if (!agentPk) {
    throw new Error(`невалидный agent-pubkey: "${agentPubkeyHex}"`);
  }
  if (!Array.isArray(tag) || tag.length !== 4 || tag[0] !== "auth") {
    throw new Error("auth-тег должен быть массивом ровно из 4 элементов");
  }
  const [, ownerRaw, conditions, sig] = tag as [string, string, string, string];
  const ownerPk = normalizePubkeyHex(ownerRaw);
  if (!ownerPk || ownerRaw !== ownerPk) {
    throw new Error("owner-pubkey должен быть 64-символьным lowercase hex");
  }
  if (typeof conditions !== "string") {
    throw new Error("conditions должны быть строкой");
  }
  validateConditions(conditions);
  if (typeof sig !== "string" || !SIG_HEX_RE.test(sig)) {
    throw new Error("подпись должна быть 128-символьным lowercase hex");
  }
  if (ownerPk === agentPk) {
    throw new Error("самоаттестация запрещена (owner == agent, спека NIP-OA)");
  }
  const digest = computePreimageDigestHex(agentPk, conditions);
  if (!schnorr.verify(sig, digest, ownerPk)) {
    throw new Error("подпись не проходит проверку против прообраза");
  }
  return ownerPk;
}

/** JSON-значение тега для env BUZZ_AUTH_TAG (buzz-cli) / заголовка x-auth-tag. */
export function authTagEnvValue(tag: AuthTag): string {
  return JSON.stringify(tag);
}
