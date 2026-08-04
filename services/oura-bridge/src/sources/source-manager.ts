import type { ExternalAgentDef } from "../agents/definition.js";

/**
 * Держит запущенные источники (Telegram-боты внешних агентов) в соответствии
 * со снапшотом описаний с relay: новый активный агент — старт, исчезнувший или
 * выключенный — стоп, сменившийся токен — перезапуск. Ошибка одного бота
 * (расшифровка, невалидный токен, сеть) никогда не мешает остальным.
 */

export type SourceStatus = "running" | "error" | "conflict" | "inactive";

/** Запущенный источник; прод-реализация — TelegramChannel + Router. */
export interface StartedSource {
  stop(): Promise<void>;
}

export interface SourceChannelFactory {
  /** Поднимает бота агента; бросает, если старт не удался (мёртвый токен и т.п.). */
  create(def: ExternalAgentDef, token: string): Promise<StartedSource>;
}

export interface SourceManagerDeps {
  /** Расшифровка токена из описания; бросает на битом шифртексте. */
  decryptToken(def: ExternalAgentDef): string;
  factory: SourceChannelFactory;
  log?: (line: string) => void;
}

interface RunningEntry {
  def: ExternalAgentDef;
  source: StartedSource;
  token: string;
}

export class SourceManager {
  private readonly running = new Map<string, RunningEntry>();
  private readonly status = new Map<string, SourceStatus>();
  private readonly log: (line: string) => void;

  constructor(private readonly deps: SourceManagerDeps) {
    this.log = deps.log ?? ((line) => console.log(line));
  }

  /** Текущие статусы по agentId (running/error/conflict/inactive). */
  statuses(): ReadonlyMap<string, SourceStatus> {
    return this.status;
  }

  async reconcile(defs: ExternalAgentDef[]): Promise<void> {
    const desired = new Map(defs.map((d) => [d.agentId, d]));

    // остановить исчезнувших и выключенных
    for (const [agentId, entry] of [...this.running]) {
      const next = desired.get(agentId);
      if (next?.isActive && next.botTokenEnc === entry.def.botTokenEnc) {
        continue;
      }
      await this.stopEntry(agentId, entry);
      if (next && !next.isActive) this.status.set(agentId, "inactive");
      else if (!next) this.status.delete(agentId);
      // сменившийся токен: статус выставит фаза старта ниже
    }

    // расшифровать токены желаемых активных (для старта и поиска конфликтов)
    const startable: Array<{ def: ExternalAgentDef; token: string }> = [];
    for (const def of desired.values()) {
      if (!def.isActive) {
        if (!this.running.has(def.agentId)) {
          this.status.set(def.agentId, "inactive");
        }
        continue;
      }
      if (this.running.has(def.agentId)) continue; // уже работает с тем же токеном
      try {
        startable.push({ def, token: this.deps.decryptToken(def) });
      } catch (e) {
        this.status.set(def.agentId, "error");
        this.log(
          `[sources] агент ${def.agentId}: токен не расшифрован: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }

    // «один бот — один агент»: при совпадении токенов работает старейший
    const tokenOwners = new Map<string, ExternalAgentDef>();
    for (const entry of this.running.values()) {
      tokenOwners.set(entry.token, entry.def);
    }
    for (const { def, token } of [...startable].sort(
      (a, b) => a.def.createdAt - b.def.createdAt,
    )) {
      const owner = tokenOwners.get(token);
      if (owner && owner.agentId !== def.agentId) {
        this.status.set(def.agentId, "conflict");
        this.log(
          `[sources] агент ${def.agentId}: бот уже занят агентом ${owner.agentId} — пропуск`,
        );
        continue;
      }
      tokenOwners.set(token, def);
      await this.startEntry(def, token);
    }
  }

  async stopAll(): Promise<void> {
    for (const [agentId, entry] of [...this.running]) {
      await this.stopEntry(agentId, entry);
    }
  }

  private async startEntry(
    def: ExternalAgentDef,
    token: string,
  ): Promise<void> {
    try {
      const source = await this.deps.factory.create(def, token);
      this.running.set(def.agentId, { def, source, token });
      this.status.set(def.agentId, "running");
      this.log(`[sources] агент ${def.agentId} («${def.name}»): бот запущен`);
    } catch (e) {
      this.status.set(def.agentId, "error");
      this.log(
        `[sources] агент ${def.agentId}: бот не стартовал: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  private async stopEntry(agentId: string, entry: RunningEntry): Promise<void> {
    this.running.delete(agentId);
    try {
      await entry.source.stop();
    } catch (e) {
      this.log(
        `[sources] агент ${agentId}: ошибка остановки бота (игнорирую): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    this.log(`[sources] агент ${agentId}: бот остановлен`);
  }
}
