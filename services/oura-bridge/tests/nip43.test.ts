import { describe, expect, it } from "vitest";
import { generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools/pure";
import * as nip19 from "nostr-tools/nip19";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import {
  buildNip98AuthHeader,
  buildRelayAddMemberEvent,
  registerRelayMember,
} from "../src/buzz/nip43.js";

const sk = generateSecretKey();
const SERVICE_NSEC = nip19.nsecEncode(sk);
const SERVICE_PK = getPublicKey(sk);
const LEAD_PK = "ab".repeat(32);

function tagValue(tags: string[][], name: string): string | undefined {
  return tags.find((t) => t[0] === name)?.[1];
}

describe("buildRelayAddMemberEvent", () => {
  it("строит валидное подписанное событие kind:9030 с p-тегом лида", () => {
    const ev = buildRelayAddMemberEvent(SERVICE_NSEC, LEAD_PK, 1_700_000_000);
    expect(ev.kind).toBe(9030);
    expect(ev.pubkey).toBe(SERVICE_PK);
    expect(ev.created_at).toBe(1_700_000_000);
    expect(tagValue(ev.tags, "p")).toBe(LEAD_PK);
    expect(verifyEvent(ev)).toBe(true);
  });

  it("невалидный pubkey лида — ошибка", () => {
    expect(() =>
      buildRelayAddMemberEvent(SERVICE_NSEC, "не-pubkey", 1_700_000_000),
    ).toThrow("не-pubkey");
  });
});

describe("buildNip98AuthHeader", () => {
  it("строит заголовок Nostr <base64> с корректным kind:27235 внутри", () => {
    const body = '{"hello":"world"}';
    const header = buildNip98AuthHeader(
      SERVICE_NSEC,
      "http://localhost:3000/events",
      "POST",
      body,
      1_700_000_000,
    );
    expect(header.startsWith("Nostr ")).toBe(true);
    const ev = JSON.parse(
      Buffer.from(header.slice("Nostr ".length), "base64").toString("utf8"),
    );
    expect(ev.kind).toBe(27235);
    expect(ev.pubkey).toBe(SERVICE_PK);
    expect(tagValue(ev.tags, "u")).toBe("http://localhost:3000/events");
    expect(tagValue(ev.tags, "method")).toBe("POST");
    expect(tagValue(ev.tags, "payload")).toBe(
      bytesToHex(sha256(new TextEncoder().encode(body))),
    );
    expect(verifyEvent(ev)).toBe(true);
  });
});

describe("registerRelayMember", () => {
  it("шлёт подписанное 9030 на <relay>/events с NIP-98-заголовком", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ accepted: true }), { status: 200 });
    }) as unknown as typeof fetch;
    await registerRelayMember({
      relayUrl: "http://localhost:3000/",
      serviceNsec: SERVICE_NSEC,
      leadPubkeyHex: LEAD_PK,
      fetchImpl,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://localhost:3000/events");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization.startsWith("Nostr ")).toBe(true);
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.kind).toBe(9030);
    expect(tagValue(sent.tags, "p")).toBe(LEAD_PK);
  });

  it("не-2xx ответ — ошибка с телом ответа", async () => {
    const fetchImpl = (async () =>
      new Response('{"error":"actor not authorized"}', {
        status: 401,
      })) as unknown as typeof fetch;
    await expect(
      registerRelayMember({
        relayUrl: "http://localhost:3000",
        serviceNsec: SERVICE_NSEC,
        leadPubkeyHex: LEAD_PK,
        fetchImpl,
      }),
    ).rejects.toThrow("actor not authorized");
  });

  it("HTTP 200, но accepted=false — ошибка", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ accepted: false, message: "rejected" }), {
        status: 200,
      })) as unknown as typeof fetch;
    await expect(
      registerRelayMember({
        relayUrl: "http://localhost:3000",
        serviceNsec: SERVICE_NSEC,
        leadPubkeyHex: LEAD_PK,
        fetchImpl,
      }),
    ).rejects.toThrow("rejected");
  });
});
