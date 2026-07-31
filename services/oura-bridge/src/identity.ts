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
