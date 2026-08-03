import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BoundaryAuditLog, type AuditEntry } from "../src/policy/audit.js";

function tmpAuditPath(): string {
  return join(
    mkdtempSync(join(tmpdir(), "oura-audit-")),
    "boundary-audit.jsonl",
  );
}

const fixedNow = () => 1_722_500_000_000;

describe("BoundaryAuditLog", () => {
  it("append пишет JSONL-строку с типом и временем из инжектированных часов", async () => {
    const log = new BoundaryAuditLog(tmpAuditPath(), fixedNow);
    await log.append({
      type: "inbound_ingress",
      chatId: "42",
      leadPubkey: "ab".repeat(32),
      channelId: "chan-1",
    });
    const entries = await log.readAll();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe("inbound_ingress");
    expect(entries[0]?.at).toBe(fixedNow());
  });

  it("сохраняет порядок записей и переживает рестарт (новый инстанс читает файл)", async () => {
    const path = tmpAuditPath();
    const log = new BoundaryAuditLog(path, fixedNow);
    await log.append({
      type: "membership_denied",
      channelId: "chan-1",
      pubkey: "cd".repeat(32),
      reason: "внутренний агент изолирован от внешнего блока (Р10)",
    });
    await log.append({
      type: "outbound_egress",
      chatId: "42",
      authorPubkey: "ef".repeat(32),
      eventId: "evt-1",
    });

    const reopened = new BoundaryAuditLog(path, fixedNow);
    const entries = await reopened.readAll();
    expect(entries.map((e: AuditEntry) => e.type)).toEqual([
      "membership_denied",
      "outbound_egress",
    ]);
  });

  it("конкурентные append сериализуются — N записей, каждая строка валидный JSON", async () => {
    const log = new BoundaryAuditLog(tmpAuditPath(), fixedNow);
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        log.append({
          type: "attestation_issued",
          leadPubkey: "ab".repeat(32),
          ownerPubkey: "cd".repeat(32),
          note: `issue-${i}`,
        }),
      ),
    );
    const entries = await log.readAll();
    expect(entries).toHaveLength(25);
  });

  it("пустой/отсутствующий файл — пустой список, не ошибка", async () => {
    const log = new BoundaryAuditLog(tmpAuditPath(), fixedNow);
    expect(await log.readAll()).toEqual([]);
  });

  it("битая строка в файле — fail-fast при чтении (не тихая потеря аудита)", async () => {
    const path = tmpAuditPath();
    const log = new BoundaryAuditLog(path, fixedNow);
    await log.append({
      type: "membership_grant",
      channelId: "chan-1",
      pubkey: "ab".repeat(32),
    });
    const { appendFile } = await import("node:fs/promises");
    await appendFile(path, "не-json\n", "utf8");
    await expect(log.readAll()).rejects.toThrow();
  });
});
