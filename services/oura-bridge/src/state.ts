import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface LeadRecord {
  chatId: string;
  name: string;
  nsec: string;
  pubkeyHex: string;
  channelId: string;
  /**
   * epoch-ms последней активности (входящее лида или доставленный ему ответ).
   * Лиды за пределами окна активности не поллятся (B5); у legacy-записей
   * метка выставляется временем загрузки state-файла.
   */
  lastActivityAt?: number;
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

  static async load(
    path: string,
    now: number = Date.now(),
  ): Promise<StateStore> {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (e) {
      // Пустой старт допустим ТОЛЬКО когда файла ещё нет. Любой другой сбой
      // чтения означает риск молча забыть nsec всех лидов (они существуют
      // только в этом файле) и начать плодить дубликаты комнат.
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return new StateStore(path, { leads: {} });
      }
      throw new Error(
        `не удалось прочитать state-файл ${path}; мост остановлен, чтобы не потерять ключи лидов — проверьте файл или восстановите из ${path}.bak`,
        { cause: e },
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(
        `state-файл ${path} повреждён (битый JSON); мост остановлен, чтобы не потерять ключи лидов — восстановите файл из ${path}.bak`,
        { cause: e },
      );
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      typeof (parsed as StateFile).leads !== "object" ||
      (parsed as StateFile).leads === null
    ) {
      throw new Error(
        `state-файл ${path} имеет неожиданную форму (нет объекта leads); восстановите файл из ${path}.bak`,
      );
    }
    const data = parsed as StateFile;
    for (const lead of Object.values(data.leads)) {
      lead.lastActivityAt ??= now;
    }
    return new StateStore(path, data);
  }

  private async writeNow(): Promise<void> {
    this.data.seenEventIds = [...this.legacySeen];
    this.data.seenByLead = Object.fromEntries(
      [...this.seenByLead.entries()].map(([chatId, ids]) => [chatId, [...ids]]),
    );
    await mkdir(dirname(this.path), { recursive: true });
    // Предыдущая версия уходит в .bak ДО замены основного файла — единственная
    // страховка от потери лид-ключей при порче основного файла (load fail-fast
    // отсылает оператора именно к .bak).
    try {
      await copyFile(this.path, `${this.path}.bak`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      // первой записи файл не предшествует — бэкапить нечего
    }
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

  /**
   * `key` — ключ записи в state. В легаси-режиме (один бот) это сырой chatId;
   * в мульти-бот режиме роутер источника передаёт составной ключ
   * `tg:<agentId>:<chatId>`, чтобы один человек в двух ботах был двумя лидами.
   */
  getLead(key: string): LeadRecord | undefined {
    return this.data.leads[key];
  }

  putLead(lead: LeadRecord, key: string = lead.chatId): void {
    this.data.leads[key] = lead;
  }

  allLeads(): LeadRecord[] {
    return Object.values(this.data.leads);
  }

  /** Отмечает активность лида; неизвестный ключ — no-op. */
  touchLead(key: string, now: number): void {
    const lead = this.data.leads[key];
    if (lead) lead.lastActivityAt = now;
  }

  /** Лиды с активностью внутри окна — только их поллит роутер (B5). */
  activeLeads(now: number, windowMs: number): LeadRecord[] {
    return this.activeLeadEntries(now, windowMs).map((e) => e.lead);
  }

  /** То же с ключами записей — роутер фильтрует по своему префиксу. */
  activeLeadEntries(
    now: number,
    windowMs: number,
  ): Array<{ key: string; lead: LeadRecord }> {
    return Object.entries(this.data.leads)
      .filter(([, l]) => (l.lastActivityAt ?? now) >= now - windowMs)
      .map(([key, lead]) => ({ key, lead }));
  }

  hasSeen(key: string, eventId: string): boolean {
    if (this.legacySeen.has(eventId)) return true;
    return this.seenByLead.get(key)?.has(eventId) ?? false;
  }

  markSeen(key: string, eventId: string): void {
    let ids = this.seenByLead.get(key);
    if (!ids) {
      ids = new Set();
      this.seenByLead.set(key, ids);
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
