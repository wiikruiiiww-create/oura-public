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
  seenEventIds: string[];
}

const SEEN_CAP = 5000;

/** JSON-файл состояния моста (Фаза 0; в Фазе 1 заменяется Postgres). */
export class StateStore {
  private saveChain: Promise<void> = Promise.resolve();

  private constructor(
    private readonly path: string,
    private readonly data: StateFile,
    private readonly seen: Set<string>,
  ) {}

  static async load(path: string): Promise<StateStore> {
    let data: StateFile = { leads: {}, seenEventIds: [] };
    try {
      data = JSON.parse(await readFile(path, "utf8")) as StateFile;
    } catch {
      // файла ещё нет — стартуем с пустого состояния
    }
    return new StateStore(path, data, new Set(data.seenEventIds));
  }

  private async writeNow(): Promise<void> {
    this.data.seenEventIds = [...this.seen];
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(this.data, null, 2), "utf8");
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

  hasSeen(eventId: string): boolean {
    return this.seen.has(eventId);
  }

  markSeen(eventId: string): void {
    this.seen.add(eventId);
    if (this.seen.size > SEEN_CAP) {
      const excess = this.seen.size - SEEN_CAP;
      const it = this.seen.values();
      for (let i = 0; i < excess; i++) {
        const v = it.next().value;
        if (v !== undefined) this.seen.delete(v);
      }
    }
  }
}
