import * as nip19 from "nostr-tools/nip19";
import * as nip44 from "nostr-tools/nip44";

/**
 * NIP-44-шифрование токена бота. Клиент (форма создания агента) шифрует токен
 * для pubkey сервиса моста; мост расшифровывает своим nsec + pubkey автора
 * события. Токен живёт на relay ТОЛЬКО в таком виде — открытым текстом он
 * существует в памяти моста и нигде больше.
 */

function decodeNsec(nsec: string, who: string): Uint8Array {
  let decoded: ReturnType<typeof nip19.decode>;
  try {
    decoded = nip19.decode(nsec);
  } catch (e) {
    throw new Error(`${who}: не удалось декодировать nsec`, { cause: e });
  }
  if (decoded.type !== "nsec") {
    throw new Error(`${who}: ожидается nsec-ключ, получен ${decoded.type}`);
  }
  return decoded.data;
}

/** Шифрует plaintext для получателя (референс для клиента + тесты моста). */
export function encryptForPubkey(
  senderNsec: string,
  recipientPubkeyHex: string,
  plaintext: string,
): string {
  const sk = decodeNsec(senderNsec, "encryptForPubkey");
  const key = nip44.v2.utils.getConversationKey(sk, recipientPubkeyHex);
  return nip44.v2.encrypt(plaintext, key);
}

/** Расшифровывает шифртекст от отправителя; на мусоре бросает понятную ошибку. */
export function decryptFromPubkey(
  recipientNsec: string,
  senderPubkeyHex: string,
  ciphertext: string,
): string {
  const sk = decodeNsec(recipientNsec, "decryptFromPubkey");
  const key = nip44.v2.utils.getConversationKey(sk, senderPubkeyHex);
  try {
    return nip44.v2.decrypt(ciphertext, key);
  } catch (e) {
    throw new Error(
      "не удалось расшифровать токен бота (шифртекст повреждён или шифрован не для этого ключа)",
      { cause: e },
    );
  }
}
