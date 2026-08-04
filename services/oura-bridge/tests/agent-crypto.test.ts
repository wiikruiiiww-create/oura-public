import { describe, expect, it } from "vitest";
import { mintIdentity } from "../src/identity.js";
import { decryptFromPubkey, encryptForPubkey } from "../src/agents/crypto.js";

describe("NIP-44 шифрование токена бота", () => {
  it("roundtrip: клиент шифрует мосту, мост расшифровывает", () => {
    const creator = mintIdentity(); // автор события (создатель агента)
    const bridge = mintIdentity(); // сервисный ключ моста
    const token = "1234567890:AAF-примерТокенаБота_с-юникодом-😀";

    const cipher = encryptForPubkey(creator.nsec, bridge.pubkeyHex, token);
    expect(cipher).not.toContain("1234567890"); // токен не в открытом виде

    const plain = decryptFromPubkey(bridge.nsec, creator.pubkeyHex, cipher);
    expect(plain).toBe(token);
  });

  it("чужой ключ не расшифровывает", () => {
    const creator = mintIdentity();
    const bridge = mintIdentity();
    const stranger = mintIdentity();
    const cipher = encryptForPubkey(creator.nsec, bridge.pubkeyHex, "секрет");

    expect(() =>
      decryptFromPubkey(stranger.nsec, creator.pubkeyHex, cipher),
    ).toThrow();
  });

  it("мусор вместо шифртекста → понятная ошибка, не падение процесса", () => {
    const creator = mintIdentity();
    const bridge = mintIdentity();

    expect(() =>
      decryptFromPubkey(bridge.nsec, creator.pubkeyHex, "не-шифртекст"),
    ).toThrow(/расшифров/);
  });

  it("не-nsec вместо ключа → понятная ошибка", () => {
    const creator = mintIdentity();
    expect(() =>
      encryptForPubkey("npub1что-то-не-то", creator.pubkeyHex, "x"),
    ).toThrow(/nsec/);
  });
});
