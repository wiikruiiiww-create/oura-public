export type AgentKind = "internal" | "external";

const OPTIONS: Array<{
  value: AgentKind;
  label: string;
  hint: string;
}> = [
  {
    value: "internal",
    label: "Внутренний",
    hint: "Работает в командных каналах, запускается на этом компьютере",
  },
  {
    value: "external",
    label: "Внешний",
    hint: "Отвечает обращениям клиентов, работает на сервисе лидов",
  },
];

/**
 * Тип агента выбирается до всего остального: от него зависит и форма, и то,
 * куда агента вообще можно добавить (внешние в командные каналы не пускаются).
 */
export function AgentKindSelector({
  value,
  onChange,
  disabled = false,
}: {
  value: AgentKind;
  onChange: (next: AgentKind) => void;
  disabled?: boolean;
}) {
  const active = OPTIONS.find((option) => option.value === value);

  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium">Тип агента</span>
      <div className="grid grid-cols-2 gap-2">
        {OPTIONS.map((option) => {
          const isActive = option.value === value;
          return (
            <button
              aria-pressed={isActive}
              className={`rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                isActive
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-input bg-background text-muted-foreground hover:border-primary/40"
              } ${disabled ? "pointer-events-none opacity-60" : ""}`}
              data-testid={`agent-kind-${option.value}`}
              disabled={disabled}
              key={option.value}
              onClick={() => onChange(option.value)}
              type="button"
            >
              <span className="font-medium">{option.label}</span>
            </button>
          );
        })}
      </div>
      {active ? (
        <p className="text-xs text-muted-foreground">{active.hint}</p>
      ) : null}
    </div>
  );
}
