import { decode } from "nostr-tools/nip19";

/**
 * The lead service is the server-side component that runs external agents:
 * bot tokens entered in the agent form are encrypted to its public key, so the
 * community stores that key as a plain setting.
 *
 * Accepts hex or npub and always returns hex — the form is where a mistyped
 * key must be caught, since a wrong key silently produces a token nothing can
 * decrypt.
 */

const HEX_PUBKEY = /^[0-9a-f]{64}$/;

export type LeadServiceKeyResult =
  /** `null` = the field was left empty, which is allowed */
  { hex: string | null } | { error: string };

export function parseLeadServiceKey(raw: string): LeadServiceKeyResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { hex: null };

  if (trimmed.startsWith("nsec1")) {
    return {
      error: "Это приватный ключ (nsec). Нужен публичный ключ сервиса — npub.",
    };
  }

  const lowered = trimmed.toLowerCase();
  if (HEX_PUBKEY.test(lowered)) return { hex: lowered };

  if (trimmed.startsWith("npub1")) {
    try {
      const decoded = decode(trimmed);
      if (decoded.type === "npub" && typeof decoded.data === "string") {
        return { hex: decoded.data };
      }
    } catch {
      // ниже — общее сообщение об ошибке
    }
  }

  return { error: "Не похоже на ключ: ожидается npub или 64 hex-символа." };
}
