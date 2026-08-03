import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Аудит пересечений границы блоков (план ядра, этап 2). Каждое событие
 * «вошло извне» / «вышло наружу» / «grant-deny членства» / «выпущена
 * аттестация» — строка JSONL в append-only файле рядом с состоянием моста.
 * MVP до Postgres-схемы оркестратора; интеграция с hash-chain buzz-audit —
 * позже. Формат каждой строки: AuditEntry с полем at (unix ms).
 */

export type AuditEvent =
  /** внешнее сообщение принято и опубликовано в комнату лида */
  | {
      type: "inbound_ingress";
      chatId: string;
      leadPubkey: string;
      channelId: string;
    }
  /** сообщение из комнаты доставлено во внешний канал */
  | {
      type: "outbound_egress";
      chatId: string;
      authorPubkey: string;
      eventId: string;
    }
  /** сообщение из комнаты НЕ выпущено наружу (политика/фильтр) */
  | {
      type: "outbound_suppressed";
      chatId: string;
      authorPubkey: string;
      eventId: string;
      reason: string;
    }
  /** членство в канале выдано */
  | { type: "membership_grant"; channelId: string; pubkey: string }
  /** членство отклонено политикой границы */
  | {
      type: "membership_denied";
      channelId: string;
      pubkey: string;
      reason: string;
    }
  /** выпущена NIP-OA-аттестация лид-ключа */
  | {
      type: "attestation_issued";
      leadPubkey: string;
      ownerPubkey: string;
      note?: string;
    };

export type AuditEntry = AuditEvent & { at: number };

export class BoundaryAuditLog {
  /** Сериализация append'ов — та же дисциплина, что saveChain в StateStore. */
  private appendChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly now: () => number = Date.now,
  ) {}

  append(event: AuditEvent): Promise<void> {
    const entry: AuditEntry = { ...event, at: this.now() };
    const line = `${JSON.stringify(entry)}\n`;
    const next = this.appendChain.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await appendFile(this.path, line, "utf8");
    });
    // Ошибка одного append не должна навсегда ломать цепочку следующих.
    this.appendChain = next.catch(() => {});
    return next;
  }

  /**
   * Читает весь журнал. Битая строка — ошибка (fail-fast): молча пропущенная
   * запись аудита хуже упавшего чтения.
   */
  async readAll(): Promise<AuditEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch {
      return []; // файла ещё нет — журнал пуст
    }
    return raw
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line, i) => {
        try {
          return JSON.parse(line) as AuditEntry;
        } catch {
          throw new Error(
            `битая строка аудита #${i + 1}: ${line.slice(0, 80)}`,
          );
        }
      });
  }
}
