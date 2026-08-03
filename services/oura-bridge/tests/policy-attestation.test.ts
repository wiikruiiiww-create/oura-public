import { hexToBytes } from "@noble/hashes/utils";
import * as nip19 from "nostr-tools/nip19";
import { describe, expect, it } from "vitest";
import {
  type AuthTag,
  authTagEnvValue,
  computeAuthTag,
  computePreimageDigestHex,
  validateConditions,
  verifyAuthTag,
} from "../src/policy/attestation.js";

// Тест-векторы из docs/nips/NIP-OA.md («Test Vectors»)
const ownerSecretHex =
  "0000000000000000000000000000000000000000000000000000000000000001";
const ownerPubkey =
  "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const agentPubkey =
  "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5";
const conditions = "kind=1&created_at<1713957000";
const vectorDigest =
  "08cdecd55af4c28d3801fd69615dcf5cc04fab3bc134b38a840bf157197069a6";
const vectorSig =
  "8b7df2575caf0a108374f8471722b233c53f9ff827a8b0f91861966c3b9dd5cb2e189eae9f49d72187674c2f5bd244145e10ff86c9f257ffe65a1ee5f108b369";
const vectorTag = ["auth", ownerPubkey, conditions, vectorSig];
const vectorTagBytesHex =
  "5b2261757468222c2237396265363637656639646362626163353561303632393563653837306230373032396266636462326463653238643935396632383135623136663831373938222c226b696e643d3126637265617465645f61743c31373133393537303030222c223862376466323537356361663061313038333734663834373137323262323333633533663966663832376138623066393138363139363663336239646435636232653138396561653966343964373231383736373463326635626432343431343565313066663836633966323537666665363561316565356631303862333639225d";

const ownerNsec = nip19.nsecEncode(hexToBytes(ownerSecretHex));

describe("computePreimageDigestHex — прообраз подписи по спеке", () => {
  it("совпадает с sha256(preimage) из тест-вектора", () => {
    expect(computePreimageDigestHex(agentPubkey, conditions)).toBe(
      vectorDigest,
    );
  });
});

describe("verifyAuthTag", () => {
  it("принимает эталонный тег из спеки и возвращает owner-pubkey", () => {
    expect(verifyAuthTag(vectorTag, agentPubkey)).toBe(ownerPubkey);
  });

  it("отклоняет тег с неверной длиной (не 4 элемента)", () => {
    expect(() => verifyAuthTag(vectorTag.slice(0, 3), agentPubkey)).toThrow();
    expect(() => verifyAuthTag([...vectorTag, "x"], agentPubkey)).toThrow();
  });

  it("отклоняет самоаттестацию (owner == agent)", () => {
    expect(() => verifyAuthTag(vectorTag, ownerPubkey)).toThrow(
      /самоаттестация/,
    );
  });

  it("отклоняет подпись, не совпадающую с прообразом", () => {
    const forged = [...vectorTag];
    forged[2] = "kind=2";
    expect(() => verifyAuthTag(forged, agentPubkey)).toThrow(/подпись/);
  });
});

describe("computeAuthTag", () => {
  it("выдаёт валидный тег: 4 элемента, owner из nsec, verify проходит", () => {
    const tag = computeAuthTag({
      ownerNsec,
      agentPubkeyHex: agentPubkey,
      conditions,
    });
    expect(tag).toHaveLength(4);
    expect(tag[0]).toBe("auth");
    expect(tag[1]).toBe(ownerPubkey);
    expect(tag[2]).toBe(conditions);
    expect(verifyAuthTag(tag, agentPubkey)).toBe(ownerPubkey);
  });

  it("условия по умолчанию — пустая строка (без ограничений)", () => {
    const tag = computeAuthTag({ ownerNsec, agentPubkeyHex: agentPubkey });
    expect(tag[2]).toBe("");
    expect(verifyAuthTag(tag, agentPubkey)).toBe(ownerPubkey);
  });

  it("запрещает самоаттестацию при выпуске", () => {
    expect(() =>
      computeAuthTag({ ownerNsec, agentPubkeyHex: ownerPubkey }),
    ).toThrow(/самоаттестация/);
  });

  it("отклоняет невалидный agent-pubkey", () => {
    expect(() =>
      computeAuthTag({ ownerNsec, agentPubkeyHex: "не-hex" }),
    ).toThrow(/pubkey/);
  });
});

describe("validateConditions — грамматика по спеке", () => {
  it("пустая строка и валидные клаузы проходят", () => {
    expect(() => validateConditions("")).not.toThrow();
    expect(() => validateConditions("kind=0")).not.toThrow();
    expect(() =>
      validateConditions("kind=1&created_at<1713957000"),
    ).not.toThrow();
    expect(() => validateConditions("created_at>0")).not.toThrow();
  });

  it("отклоняет мусор из «Invalid Test Vectors» спеки", () => {
    expect(() => validateConditions("kind=1&")).toThrow(); // хвостовой &
    expect(() => validateConditions("&kind=1")).toThrow(); // ведущий &
    expect(() => validateConditions("kind=1&&kind=2")).toThrow(); // двойной &
    expect(() => validateConditions("kind=01")).toThrow(); // ведущий ноль
    expect(() => validateConditions(" kind=1")).toThrow(); // пробел
    expect(() => validateConditions("kind=70000")).toThrow(); // > 65535
    expect(() => validateConditions("created_at<4294967296")).toThrow(); // > u32
    expect(() => validateConditions("KIND=1")).toThrow(); // регистр
  });
});

describe("authTagEnvValue — значение для BUZZ_AUTH_TAG", () => {
  it("JSON-кодировка эталонного тега побайтово равна tag-bytes-hex из спеки", () => {
    const json = authTagEnvValue(vectorTag as AuthTag);
    expect(Buffer.from(json, "utf8").toString("hex")).toBe(vectorTagBytesHex);
  });
});
