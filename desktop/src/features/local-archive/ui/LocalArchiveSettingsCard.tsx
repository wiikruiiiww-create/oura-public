import { Archive, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import {
  createSaveSubscription,
  deleteSaveSubscription,
  listSaveSubscriptions,
  mergeSaveSubscriptionKinds,
  removeSaveSubscriptionKind,
  type SaveSubscription,
  type ScopeType,
} from "@/shared/api/tauriArchive";
import {
  KIND_AGENT_OBSERVER_FRAME,
  KIND_AGENT_TURN_METRIC,
} from "@/shared/constants/kinds";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Switch } from "@/shared/ui/switch";
import {
  SettingsOptionGroup,
  SettingsOptionRow,
} from "@/features/settings/ui/SettingsOptionGroup";
import { SettingsSectionHeader } from "@/features/settings/ui/SettingsSectionHeader";
import { observerArchiveDefaultEnabled } from "@/shared/api/tauriArchive";
import { setExplicitAgentMetricArchiveChoice } from "../agentMetricArchivePreference";

import {
  buildSubscriptionRequest,
  isGroupFullyChecked,
  isGroupIndeterminate,
  KIND_GROUPS,
  parseCustomKinds,
  toggleGroup,
  toggleKind,
} from "./localArchiveKinds";

// ── Helpers ───────────────────────────────────────────────────────────────────

function scopeLabel(
  sub: SaveSubscription,
  channelNameById: Map<string, string>,
): string {
  if (sub.scopeType === "channel_h") {
    return channelNameById.get(sub.scopeValue) ?? sub.scopeValue;
  }
  if (sub.scopeType === "owner_p") {
    if (sub.kinds.includes(KIND_AGENT_TURN_METRIC)) {
      return "Метрики ходов моих агентов";
    }
    return "Кадры сессий моих агентов";
  }
  return sub.scopeValue;
}

function kindSummary(kinds: number[]): string {
  if (kinds.length === 0) return "нет типов";
  if (kinds.length <= 4) return kinds.join(", ");
  return `${kinds.slice(0, 3).join(", ")} +${kinds.length - 3} ещё`;
}

// ── Observer-feed archive section ─────────────────────────────────────────────

type ObserverSectionProps = {
  enabled: boolean;
  policy: boolean | undefined;
  toggling: boolean;
  onToggle: (checked: boolean) => void;
};

function ObserverArchiveSection({
  enabled,
  policy,
  toggling,
  onToggle,
}: ObserverSectionProps) {
  const toggleDisabled = toggling || policy === undefined || policy === true;
  return (
    <div className="space-y-3" data-testid="local-archive-observer-section">
      <h2 className="text-lg font-semibold tracking-tight">
        Лента наблюдения за агентами
      </h2>
      <SettingsOptionGroup>
        <SettingsOptionRow>
          <div className="min-w-0 flex-1">
            <label
              className="text-sm font-medium"
              htmlFor="local-archive-observer-toggle"
            >
              Архивировать кадры наблюдения моих агентов
            </label>
            <p className="text-sm font-normal text-muted-foreground">
              {policy === true
                ? `Всегда включено во внутренних сборках. Кадры наблюдения типа ${KIND_AGENT_OBSERVER_FRAME} эфемерны — релей их не хранит, — поэтому локальный архив — единственный способ их сохранить.`
                : `Сохраняет кадры наблюдения типа ${KIND_AGENT_OBSERVER_FRAME}, адресованные вашему pubkey. Они эфемерны — релей их не хранит, — поэтому локальный архив — единственный способ их сохранить.`}
            </p>
          </div>
          <Switch
            checked={enabled}
            data-testid="local-archive-observer-toggle"
            disabled={toggleDisabled}
            id="local-archive-observer-toggle"
            onCheckedChange={onToggle}
          />
        </SettingsOptionRow>
      </SettingsOptionGroup>
    </div>
  );
}

// ── Agent-turn-metric archive section ────────────────────────────────────────

type AgentMetricSectionProps = {
  enabled: boolean;
  toggling: boolean;
  onToggle: (checked: boolean) => void;
};

function AgentMetricArchiveSection({
  enabled,
  toggling,
  onToggle,
}: AgentMetricSectionProps) {
  return (
    <div className="space-y-3" data-testid="local-archive-agent-metric-section">
      <h2 className="text-lg font-semibold tracking-tight">
        Метрики ходов агентов
      </h2>
      <SettingsOptionGroup>
        <SettingsOptionRow>
          <div className="min-w-0 flex-1">
            <label
              className="text-sm font-medium"
              htmlFor="local-archive-agent-metric-toggle"
            >
              Архивировать метрики ходов моих агентов
            </label>
            <p className="text-sm font-normal text-muted-foreground">
              Сохраняет события метрик хода типа {KIND_AGENT_TURN_METRIC},
              адресованные вашему pubkey. Хранятся в открытом виде в локальном
              архиве, чтобы калькуляторы расхода токенов могли читать их
              напрямую.
            </p>
          </div>
          <Switch
            checked={enabled}
            data-testid="local-archive-agent-metric-toggle"
            disabled={toggling}
            id="local-archive-agent-metric-toggle"
            onCheckedChange={onToggle}
          />
        </SettingsOptionRow>
      </SettingsOptionGroup>
    </div>
  );
}

// ── Add-subscription form ─────────────────────────────────────────────────────

type KindChecklistProps = {
  checkedKinds: ReadonlySet<number>;
  onChange: (next: Set<number>) => void;
};

function KindChecklist({ checkedKinds, onChange }: KindChecklistProps) {
  return (
    <div className="space-y-4">
      {KIND_GROUPS.map((group) => {
        const fullyChecked = isGroupFullyChecked(group, checkedKinds);
        const indeterminate = isGroupIndeterminate(group, checkedKinds);
        return (
          <div key={group.label}>
            {/* Group header */}
            <div className="mb-1.5 flex items-center gap-2">
              <Checkbox
                checked={indeterminate ? "indeterminate" : fullyChecked}
                data-testid={`local-archive-group-${group.label}`}
                id={`local-archive-group-${group.label}`}
                onCheckedChange={() =>
                  onChange(toggleGroup(group, checkedKinds))
                }
              />
              <label
                className="cursor-pointer text-sm font-medium"
                htmlFor={`local-archive-group-${group.label}`}
              >
                {group.label}
              </label>
            </div>
            {/* Individual kind checkboxes */}
            <div className="ml-6 space-y-1.5">
              {group.items.map(({ kind, label }) => (
                <div key={kind} className="flex items-center gap-2">
                  <Checkbox
                    checked={checkedKinds.has(kind)}
                    data-testid={`local-archive-kind-${kind}`}
                    id={`local-archive-kind-${kind}`}
                    onCheckedChange={() =>
                      onChange(toggleKind(kind, checkedKinds))
                    }
                  />
                  <label
                    className="cursor-pointer text-sm text-muted-foreground"
                    htmlFor={`local-archive-kind-${kind}`}
                  >
                    {label}
                  </label>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Custom kinds input ────────────────────────────────────────────────────────

type CustomKindsInputProps = {
  value: string;
  onChange: (raw: string) => void;
};

function CustomKindsInput({ value, onChange }: CustomKindsInputProps) {
  const { invalid } = parseCustomKinds(value);
  const hasInvalid = invalid.length > 0;
  return (
    <div>
      <label
        className="mb-1.5 block text-sm font-medium"
        htmlFor="local-archive-custom-kinds"
      >
        Дополнительно: свои типы
      </label>
      <input
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="local-archive-custom-kinds"
        id="local-archive-custom-kinds"
        onChange={(e) => onChange(e.target.value)}
        placeholder="например, 30023 1337"
        type="text"
        value={value}
      />
      <p className="mt-1 text-xs text-muted-foreground">
        Неотрицательные целые числа через пробел или запятую. Типы, уже
        отмеченные в списке выше, игнорируются.
      </p>
      {hasInvalid && (
        <p
          className="mt-1 text-xs text-destructive"
          data-testid="local-archive-custom-kinds-error"
        >
          Некорректные значения (игнорируются):{" "}
          {invalid.map((t, i) => (
            <React.Fragment key={t}>
              {i > 0 && ", "}
              <code className="font-mono">{t}</code>
            </React.Fragment>
          ))}
        </p>
      )}
    </div>
  );
}

// ── Add-subscription form (Steps 1 + 2) ──────────────────────────────────────

type AddFormProps = {
  channels: Array<{ id: string; name: string }>;
  onSaved: () => void;
  onCancel: () => void;
};

function AddSubscriptionForm({ channels, onSaved, onCancel }: AddFormProps) {
  const [selectedChannelId, setSelectedChannelId] = React.useState("");
  const [checkedKinds, setCheckedKinds] = React.useState<Set<number>>(
    new Set(),
  );
  const [customKindsRaw, setCustomKindsRaw] = React.useState("");
  const [isAdding, setIsAdding] = React.useState(false);

  const { valid: customKinds } = parseCustomKinds(customKindsRaw);
  const request = buildSubscriptionRequest(
    "channel_h",
    selectedChannelId,
    checkedKinds,
    customKinds,
  );
  const canAdd = request !== null;

  const handleAdd = React.useCallback(async () => {
    if (request === null) return;

    setIsAdding(true);
    try {
      await createSaveSubscription(
        request.scopeType,
        request.scopeValue,
        request.kinds,
      );
      onSaved();
      toast.success("Подписка на архив создана.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Не удалось создать подписку.",
      );
    } finally {
      setIsAdding(false);
    }
  }, [request, onSaved]);

  const handleCancel = () => {
    setSelectedChannelId("");
    setCheckedKinds(new Set());
    setCustomKindsRaw("");
    onCancel();
  };

  return (
    <SettingsOptionGroup>
      <div className="space-y-5 px-4 py-4">
        {/* Channel picker */}
        <div>
          <label
            className="mb-1.5 block text-sm font-medium"
            htmlFor="local-archive-channel-select"
          >
            Канал
          </label>
          <select
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="local-archive-channel-select"
            id="local-archive-channel-select"
            onChange={(e) => setSelectedChannelId(e.target.value)}
            value={selectedChannelId}
          >
            <option value="">Выберите канал…</option>
            {channels.map((ch) => (
              <option key={ch.id} value={ch.id}>
                {ch.name}
              </option>
            ))}
          </select>
        </div>

        {/* Event types (per-kind checklist) */}
        <div>
          <p className="mb-3 text-sm font-medium">Типы событий</p>
          <KindChecklist
            checkedKinds={checkedKinds}
            onChange={setCheckedKinds}
          />
        </div>

        {/* Advanced: custom kinds */}
        <CustomKindsInput onChange={setCustomKindsRaw} value={customKindsRaw} />

        <div className="flex justify-end gap-2">
          <Button
            disabled={isAdding}
            onClick={handleCancel}
            type="button"
            variant="outline"
          >
            Отмена
          </Button>
          <Button
            data-testid="local-archive-confirm-add"
            disabled={isAdding || !canAdd}
            onClick={() => void handleAdd()}
            type="button"
          >
            {isAdding ? "Сохранение…" : "Сохранить"}
          </Button>
        </div>
      </div>
    </SettingsOptionGroup>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function LocalArchiveSettingsCard() {
  const identityQuery = useIdentityQuery();
  const channelsQuery = useChannelsQuery();
  const [subs, setSubs] = React.useState<SaveSubscription[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [deletingKey, setDeletingKey] = React.useState<string | null>(null);
  const [isAddingOpen, setIsAddingOpen] = React.useState(false);
  const [observerToggling, setObserverToggling] = React.useState(false);
  const [metricToggling, setMetricToggling] = React.useState(false);
  const [observerPolicy, setObserverPolicy] = React.useState<
    boolean | undefined
  >(undefined);

  React.useEffect(() => {
    observerArchiveDefaultEnabled()
      .then((on) => setObserverPolicy(on))
      .catch(() => {
        // Fail closed: leave as undefined so toggle stays disabled.
      });
  }, []);

  const pubkey = identityQuery.data?.pubkey ?? "";

  const channelNameById = React.useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const ch of channelsQuery.data ?? []) {
      map.set(ch.id, ch.name);
    }
    return map;
  }, [channelsQuery.data]);

  const joinedChannels = React.useMemo(
    () => (channelsQuery.data ?? []).filter((ch) => ch.isMember),
    [channelsQuery.data],
  );

  const reload = React.useCallback(async () => {
    try {
      const rows = await listSaveSubscriptions();
      setSubs(rows);
    } catch (err) {
      console.warn("[LocalArchiveSettingsCard] list failed:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const handleDelete = React.useCallback(
    async (scopeType: ScopeType, scopeValue: string) => {
      const key = `${scopeType}:${scopeValue}`;
      setDeletingKey(key);
      try {
        await deleteSaveSubscription(scopeType, scopeValue);
        await reload();
        toast.success("Подписка на архив удалена.");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Не удалось удалить подписку.",
        );
      } finally {
        setDeletingKey(null);
      }
    },
    [reload],
  );

  const observerEnabled = subs.some(
    (s) =>
      s.scopeType === "owner_p" && s.kinds.includes(KIND_AGENT_OBSERVER_FRAME),
  );
  const metricEnabled = subs.some(
    (s) =>
      s.scopeType === "owner_p" && s.kinds.includes(KIND_AGENT_TURN_METRIC),
  );

  const handleObserverToggle = React.useCallback(
    async (checked: boolean) => {
      if (!pubkey) return;
      if (!checked && observerPolicy !== false) return;
      setObserverToggling(true);
      try {
        if (checked) {
          await mergeSaveSubscriptionKinds(KIND_AGENT_OBSERVER_FRAME);
        } else {
          await removeSaveSubscriptionKind(KIND_AGENT_OBSERVER_FRAME);
        }
        toast.success(
          checked
            ? "Архив ленты наблюдения включён."
            : "Архив ленты наблюдения отключён.",
        );
        await reload();
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : "Не удалось обновить архив наблюдения.",
        );
      } finally {
        setObserverToggling(false);
      }
    },
    [pubkey, observerPolicy, reload],
  );

  const handleMetricToggle = React.useCallback(
    async (checked: boolean) => {
      if (!pubkey) return;
      setMetricToggling(true);
      try {
        if (checked) {
          await mergeSaveSubscriptionKinds(KIND_AGENT_TURN_METRIC);
        } else {
          await removeSaveSubscriptionKind(KIND_AGENT_TURN_METRIC);
        }
        setExplicitAgentMetricArchiveChoice(pubkey, checked);
        toast.success(
          checked
            ? "Архив метрик ходов агентов включён."
            : "Архив метрик ходов агентов отключён.",
        );
        await reload();
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : "Не удалось обновить архив метрик агентов.",
        );
      } finally {
        setMetricToggling(false);
      }
    },
    [pubkey, reload],
  );

  // Non-owner_p subscriptions shown in the active-subscriptions list.
  // observer (24200) and metric (44200) owner_p subs each have their own
  // dedicated section above.
  const channelSubs = subs.filter((s) => s.scopeType !== "owner_p");

  return (
    <section className="min-w-0" data-testid="settings-local-archive">
      <SettingsSectionHeader
        title="Локальный архив"
        description="Сохраняйте копии сообщений релея в локальную базу данных SQLite в вашем OURA nest. При архивации события повторно проверяются на релее."
      />

      <div className="space-y-6">
        {/* Observer-feed archive — dedicated first-class section */}
        <ObserverArchiveSection
          enabled={observerEnabled}
          onToggle={(checked) => void handleObserverToggle(checked)}
          policy={observerPolicy}
          toggling={observerToggling}
        />

        {/* Agent-turn-metric archive — dedicated first-class section */}
        <AgentMetricArchiveSection
          enabled={metricEnabled}
          onToggle={(checked) => void handleMetricToggle(checked)}
          toggling={metricToggling}
        />

        {/* Channel subscriptions */}
        <div className="space-y-3" data-testid="local-archive-subscriptions">
          <h2 className="text-lg font-semibold tracking-tight">
            Подписки на каналы
            {channelSubs.length > 0 ? ` (${channelSubs.length})` : ""}
          </h2>
          {isLoading ? (
            <SettingsOptionGroup>
              <div className="px-4 py-3 text-sm font-normal text-muted-foreground">
                Загрузка…
              </div>
            </SettingsOptionGroup>
          ) : channelSubs.length === 0 ? (
            <SettingsOptionGroup>
              <div className="px-4 py-3 text-sm font-normal text-muted-foreground">
                Пока нет подписок на каналы. Добавьте одну ниже.
              </div>
            </SettingsOptionGroup>
          ) : (
            <SettingsOptionGroup>
              {channelSubs.map((sub) => {
                const key = `${sub.scopeType}:${sub.scopeValue}`;
                return (
                  <div
                    key={key}
                    className="flex items-center gap-3 px-4 py-3"
                    data-testid={`local-archive-sub-${key}`}
                  >
                    <Archive className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {scopeLabel(sub, channelNameById)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {sub.scopeType} · типы: {kindSummary(sub.kinds)}
                      </p>
                    </div>
                    <Button
                      aria-label={`Удалить подписку на архив для ${scopeLabel(sub, channelNameById)}`}
                      disabled={deletingKey === key}
                      onClick={() =>
                        void handleDelete(sub.scopeType, sub.scopeValue)
                      }
                      size="icon"
                      variant="ghost"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </SettingsOptionGroup>
          )}
        </div>

        {/* Add channel subscription */}
        <div className="space-y-3" data-testid="local-archive-add">
          <h2 className="text-lg font-semibold tracking-tight">
            Добавить подписку на канал
          </h2>
          {isAddingOpen ? (
            <AddSubscriptionForm
              channels={joinedChannels}
              onCancel={() => setIsAddingOpen(false)}
              onSaved={() => {
                setIsAddingOpen(false);
                void reload();
              }}
            />
          ) : (
            <SettingsOptionGroup>
              <SettingsOptionRow>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Подписаться на канал</p>
                  <p className="text-xs text-muted-foreground">
                    Выберите канал и типы событий для архивации.
                  </p>
                </div>
                <Button
                  data-testid="local-archive-open-add"
                  onClick={() => setIsAddingOpen(true)}
                  size="sm"
                  variant="outline"
                >
                  Добавить
                </Button>
              </SettingsOptionRow>
            </SettingsOptionGroup>
          )}
        </div>
      </div>
    </section>
  );
}
