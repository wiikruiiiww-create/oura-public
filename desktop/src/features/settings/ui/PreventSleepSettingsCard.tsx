import { usePreventSleepContext } from "@/features/agents/usePreventSleep";
import { Switch } from "@/shared/ui/switch";
import { SettingsOptionGroup, SettingsOptionRow } from "./SettingsOptionGroup";
import {
  setPersistentAgentAudienceEnabled,
  usePersistentAgentAudience,
} from "@/features/messages/lib/persistentAgentAudience";
import { SettingsSectionHeader } from "./SettingsSectionHeader";

export function PreventSleepSettingsCard() {
  const { enabled, setEnabled, hasRunningAgents, expired, clearExpired } =
    usePreventSleepContext();
  const persistentAudience = usePersistentAgentAudience(null);

  return (
    <section className="min-w-0" data-testid="settings-agents">
      <SettingsSectionHeader
        title="Агенты"
        description="Управляйте тем, как агенты ведут себя в переписке и запускаются на этом компьютере."
      />

      <SettingsOptionGroup>
        <SettingsOptionRow>
          <div className="min-w-0">
            <label
              className="text-sm font-medium"
              htmlFor="persistent-agent-audience-switch"
            >
              Держать агентов активными после обращения
            </label>
            <p className="text-sm font-normal text-muted-foreground">
              Агенты, к которым вы обратились, остаются выбранными для следующих
              сообщений в этом канале или треде. Вы можете убрать их из поля
              ввода в любой момент.
            </p>
          </div>
          <Switch
            checked={persistentAudience.enabled}
            data-testid="persistent-agent-audience-toggle"
            id="persistent-agent-audience-switch"
            onCheckedChange={setPersistentAgentAudienceEnabled}
          />
        </SettingsOptionRow>

        <SettingsOptionRow>
          <div className="min-w-0">
            <label
              className="text-sm font-medium"
              htmlFor="prevent-sleep-switch"
            >
              Не давать компьютеру засыпать, пока агенты активны
            </label>
            <p className="text-sm font-normal text-muted-foreground">
              Не даёт компьютеру уходить в сон, пока запущены локальные агенты.
              Автоматически отключается, когда все агенты останавливаются, или
              через 1 час без активности агентов.
            </p>
          </div>
          <Switch
            checked={enabled}
            data-testid="prevent-sleep-toggle"
            id="prevent-sleep-switch"
            onCheckedChange={(checked) => {
              if (expired) {
                clearExpired();
              }
              setEnabled(checked);
            }}
          />
        </SettingsOptionRow>
      </SettingsOptionGroup>

      {enabled && !hasRunningAgents && (
        <p className="mt-3 text-sm text-muted-foreground">
          Ожидание запуска агентов
        </p>
      )}

      {expired && (
        <p className="mt-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-700 dark:text-yellow-400">
          Блокировка сна отключилась через 1 час без активности агентов. Она
          возобновится при следующей активности агента, либо выключите и
          включите переключатель, чтобы включить её сейчас.
        </p>
      )}
    </section>
  );
}
