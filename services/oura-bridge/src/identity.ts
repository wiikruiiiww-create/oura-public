import * as nip19 from "nostr-tools/nip19";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

export interface LeadIdentity {
  nsec: string;
  pubkeyHex: string;
}

/** Минт Nostr-идентичности лида. Custody ключа — у платформы (файл состояния). */
export function mintIdentity(): LeadIdentity {
  const sk = generateSecretKey();
  return { nsec: nip19.nsecEncode(sk), pubkeyHex: getPublicKey(sk) };
}

export interface ParsedOperatorPubkeys {
  /** нормализованные (trim + lowercase) валидные 64-символьные hex-pubkey */
  valid: string[];
  /** записи, не прошедшие формат — вызывающий код решает, как реагировать */
  invalid: string[];
}

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/;

/** Нормализует hex-pubkey (trim + lowercase); null, если это не 64 hex-символа. */
export function normalizePubkeyHex(raw: string): string | null {
  const pk = raw.trim().toLowerCase();
  return HEX_PUBKEY_RE.test(pk) ? pk : null;
}

/**
 * Парсит CSV-список pubkey операторов из env: trim + toLowerCase (Nostr hex —
 * без регистра, но опечатка с копипастом из UI в верхнем регистре не должна
 * молча ломать сравнение), пустые записи отбрасываются. Формат не
 * проверяется молча — невалидные записи возвращаются отдельно, чтобы
 * вызывающий код мог упасть с fail-fast, а не тихо потерять оператора.
 */
export function parseOperatorPubkeys(raw: string): ParsedOperatorPubkeys {
  const entries = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const pk of entries) {
    if (HEX_PUBKEY_RE.test(pk)) valid.push(pk);
    else invalid.push(pk);
  }
  return { valid, invalid };
}
