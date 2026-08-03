export type SourceKind = "stub" | "telegram";

export interface StartupInput {
  /** OURA_SOURCE как задан в env — без дефолта, источник выбирается явно */
  source: string | undefined;
  /** валидные pubkey операторов из OURA_OPERATOR_PUBKEYS */
  operatorPubkeys: string[];
}

export type StartupDecision =
  | { ok: true; source: SourceKind; warnings: string[] }
  | { ok: false; errors: string[] };

/**
 * Стартовая валидация конфигурации моста. В режиме `telegram` пустой
 * allow-list операторов — отказ старта: иначе исходящее сообщение любого
 * участника лид-комнаты ретранслировалось бы клиенту (fail-open). В режиме
 * `stub` (дев-стенд) пустой список допустим, но с предупреждением.
 */
export function decideStartup(input: StartupInput): StartupDecision {
  if (input.source === undefined) {
    return {
      ok: false,
      errors: ["не задан OURA_SOURCE (допустимо: stub | telegram)"],
    };
  }
  if (input.source !== "stub" && input.source !== "telegram") {
    return {
      ok: false,
      errors: [
        `неизвестный OURA_SOURCE=${input.source} (допустимо: stub | telegram)`,
      ],
    };
  }
  if (input.source === "telegram" && input.operatorPubkeys.length === 0) {
    return {
      ok: false,
      errors: [
        "OURA_OPERATOR_PUBKEYS пуст при OURA_SOURCE=telegram — клиенту " +
          "ретранслировался бы любой участник канала; задай pubkey операторов",
      ],
    };
  }
  const warnings: string[] = [];
  if (input.operatorPubkeys.length === 0) {
    warnings.push(
      "OURA_OPERATOR_PUBKEYS пуст — клиенту ретранслируется любой участник канала (режим дев-стенда)",
    );
  }
  return { ok: true, source: input.source, warnings };
}
