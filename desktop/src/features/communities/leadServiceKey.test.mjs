import assert from "node:assert/strict";
import test from "node:test";
import { npubEncode } from "nostr-tools/nip19";

import { parseLeadServiceKey } from "./leadServiceKey.ts";

const HEX = "a".repeat(64);

test("пустое значение допустимо — сервис лидов не обязателен", () => {
  assert.deepEqual(parseLeadServiceKey(""), { hex: null });
  assert.deepEqual(parseLeadServiceKey("   "), { hex: null });
});

test("hex-ключ принимается и нормализуется к нижнему регистру", () => {
  assert.deepEqual(parseLeadServiceKey(HEX.toUpperCase()), { hex: HEX });
  assert.deepEqual(parseLeadServiceKey(`  ${HEX}  `), { hex: HEX });
});

test("npub декодируется в hex", () => {
  assert.deepEqual(parseLeadServiceKey(npubEncode(HEX)), { hex: HEX });
});

test("мусор отвергается с понятным сообщением", () => {
  const result = parseLeadServiceKey("npub1-не-ключ");
  assert.ok("error" in result);
  assert.match(result.error, /npub|ключ/i);

  assert.ok("error" in parseLeadServiceKey("zz".repeat(32)));
  assert.ok("error" in parseLeadServiceKey(HEX.slice(0, 60)));
});

test("nsec отвергается — это приватный ключ, а не адрес сервиса", () => {
  const result = parseLeadServiceKey(
    "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5",
  );
  assert.ok("error" in result);
  assert.match(result.error, /приватн/i);
});
