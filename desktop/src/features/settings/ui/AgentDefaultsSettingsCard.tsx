import { AgentDefaultsEditor } from "@/features/agents/ui/AgentDefaultsEditor";
import { SectionHeader } from "@/shared/ui/PageHeader";

export function AgentDefaultsSettingsCard() {
  return (
    <section
      className="min-w-0 space-y-4"
      data-testid="settings-global-agent-config"
    >
      <SectionHeader
        title="Настройки агентов по умолчанию"
        description="Настройки провайдера, модели, уровня усилий и окружения, наследуемые локальными агентами. Настройки конкретного агента всегда имеют приоритет."
      />
      <AgentDefaultsEditor />
    </section>
  );
}
