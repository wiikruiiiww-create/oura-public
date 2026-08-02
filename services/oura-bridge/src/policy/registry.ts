import { normalizePubkeyHex } from "../identity.js";

/**
 * Классы ключей ядра OURA (план «два блока», Р8/Р10):
 * - service        — сервисный ключ платформы (мост/оркестратор), владелец лид-комнат
 * - operator       — человек из команды тенанта
 * - lead           — внешний клиент; идентичность минтит платформа
 * - external_agent — продажный ИИ внешнего блока
 * - internal_agent — агент внутреннего блока (облачный раннер, Фаза 2)
 */
export const KEY_CLASSES = [
  "service",
  "operator",
  "lead",
  "external_agent",
  "internal_agent",
] as const;

export type KeyClass = (typeof KEY_CLASSES)[number];

export function isKeyClass(value: string): value is KeyClass {
  return (KEY_CLASSES as readonly string[]).includes(value);
}

export interface IdentityRecord {
  pubkeyHex: string;
  class: KeyClass;
  /** человекочитаемая метка для логов/аудита («мост», «Иван из ТГ 42», …) */
  label?: string;
}

export interface RegistryJson {
  identities: Array<{ pubkeyHex: string; class: string; label?: string }>;
}

/**
 * Реестр идентичностей — единственный источник ответа «какого класса этот
 * ключ». У ключа ровно один класс на всю жизнь: повторная регистрация с тем
 * же классом идемпотентна, с другим — ошибка (иначе смена класса становится
 * путём обхода границы блоков). Незнакомый ключ = null, политика границы
 * трактует это как deny (fail-closed).
 */
export class IdentityRegistry {
  private readonly byPubkey = new Map<string, IdentityRecord>();

  register(record: {
    pubkeyHex: string;
    class: KeyClass;
    label?: string;
  }): void {
    const pk = normalizePubkeyHex(record.pubkeyHex);
    if (!pk) {
      throw new Error(`невалидный pubkey: "${record.pubkeyHex}"`);
    }
    const existing = this.byPubkey.get(pk);
    if (existing) {
      if (existing.class !== record.class) {
        throw new Error(
          `у ключа ${pk.slice(0, 8)}… уже класс "${existing.class}" — смена класса запрещена`,
        );
      }
      return;
    }
    this.byPubkey.set(pk, {
      pubkeyHex: pk,
      class: record.class,
      ...(record.label !== undefined ? { label: record.label } : {}),
    });
  }

  classify(pubkeyHex: string): KeyClass | null {
    const pk = normalizePubkeyHex(pubkeyHex);
    if (!pk) return null;
    return this.byPubkey.get(pk)?.class ?? null;
  }

  list(cls?: KeyClass): IdentityRecord[] {
    const all = [...this.byPubkey.values()];
    return cls ? all.filter((r) => r.class === cls) : all;
  }

  toJSON(): RegistryJson {
    return {
      identities: this.list().map((r) => ({
        pubkeyHex: r.pubkeyHex,
        class: r.class,
        ...(r.label !== undefined ? { label: r.label } : {}),
      })),
    };
  }

  static fromJSON(json: RegistryJson): IdentityRegistry {
    const reg = new IdentityRegistry();
    for (const rec of json.identities) {
      if (!isKeyClass(rec.class)) {
        throw new Error(
          `неизвестный класс "${rec.class}" у ключа ${rec.pubkeyHex.slice(0, 8)}…`,
        );
      }
      reg.register({
        pubkeyHex: rec.pubkeyHex,
        class: rec.class,
        ...(rec.label !== undefined ? { label: rec.label } : {}),
      });
    }
    return reg;
  }
}
