import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface LeadRecord {
  chatId: string;
  name: string;
  nsec: string;
  pubkeyHex: string;
  channelId: string;
}

interface StateFile {
  leads: Record<string, LeadRecord>;
  /** legacy Фазы 0: глобальный список; читаем и сохраняем как есть для обратной совместимости */
  seenEventIds?: string[];
  /** Фаза 1 (I4): id доставленных сообщений по каждому лиду (chatId → event ids) */
  seenByLead?: Record<string, string[]>;
}

const PER_LEAD_SEEN_CAP = 500;

/** JSON-файл состояния моста (Фаза 0; в Фазе 1 заменяется Postgres). */
export class StateStore {
  private saveChain: Promise<void> = Promise.resolve();
  private readonly seenByLead: Map<string, Set<string>>;
  private readonly legacySeen: Set<string>;

  private constructor(
    private readonly path: string,
    private readonly data: StateFile,
  ) {
    this.legacySeen = new Set(data.seenEventIds ?? []);
    this.seenByLead = new Map(
      Object.entries(data.seenByLead ?? {}).map(([chatId, ids]) => [
        chatId,
        new Set(ids),
      ]),
    );
  }

  static async load(path: string): Promise<StateStore> {
    let data: StateFile = { leads: {} };
    try {
      data = JSON.parse(await readFile(path, "utf8")) as StateFile;
    } catch {
      // файла ещё нет — стартуем с пустого состояния
    }
    return new StateStore(path, data);
  }

  private async writeNow(): Promise<void> {
    this.data.seenEventIds = [...this.legacySeen];
    this.data.seenByLead = Object.fromEntries(
      [...this.seenByLead.entries()].map(([chatId, ids]) => [chatId, [...ids]]),
    );
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    // mode: 0o600 — файл содержит nsec (приватные ключи) всех лидов в открытом
    // виде; без явного mode право доступа зависит от umask (обычно 0644).
    await writeFile(tmp, JSON.stringify(this.data, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(tmp, this.path);
  }

  save(): Promise<void> {
    const next = this.saveChain.catch(() => {}).then(() => this.writeNow());
    // цепочка не должна навсегда «залипнуть» после одного сбоя записи
    this.saveChain = next.catch(() => {});
    return next;
  }

  getLead(chatId: string): LeadRecord | undefined {
    return this.data.leads[chatId];
  }

  putLead(lead: LeadRecord): void {
    this.data.leads[lead.chatId] = lead;
  }

  allLeads(): LeadRecord[] {
    return Object.values(this.data.leads);
  }

  hasSeen(chatId: string, eventId: string): boolean {
    if (this.legacySeen.has(eventId)) return true;
    return this.seenByLead.get(chatId)?.has(eventId) ?? false;
  }

  markSeen(chatId: string, eventId: string): void {
    let ids = this.seenByLead.get(chatId);
    if (!ids) {
      ids = new Set();
      this.seenByLead.set(chatId, ids);
    }
    ids.add(eventId);
    if (ids.size > PER_LEAD_SEEN_CAP) {
      const excess = ids.size - PER_LEAD_SEEN_CAP;
      const it = ids.values();
      for (let i = 0; i < excess; i++) {
        const v = it.next().value;
        if (v !== undefined) ids.delete(v);
      }
    }
  }
}
