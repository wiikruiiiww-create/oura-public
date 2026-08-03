import { AlertTriangle, ChevronDown, ShieldAlert } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";

import {
  useModerationAuditQuery,
  useModerationReportsQuery,
  useResolveReportMutation,
  useBanMemberMutation,
  type ModerationReport as HookModerationReport,
  type ResolutionAction,
} from "@/features/moderation/hooks";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import {
  deleteMessage,
  getEventById,
  removeChannelMember,
} from "@/shared/api/tauri";
import {
  buildModerationQueue,
  groupTopReportType,
  reportTypeLabel,
  resolvableActions,
  severityTier,
  type ModerationAction,
  type ModerationQueueGroup,
  type ModerationReport,
  type ReportStatus,
  type ReportType,
  type SeverityTier,
} from "@/features/settings/lib/moderationQueue";
import { cn } from "@/shared/lib/cn";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { SettingsSectionHeader } from "./SettingsSectionHeader";

// The queue is mod-only: only relay owners/admins may read /moderation/* (the
// relay returns 403 otherwise). Mirror that gate client-side so members never
// see the panel attempt a doomed fetch.

// --- Boundary normalizer --------------------------------------------------
//
// The shared hooks expose the wire rows; this card's triage math lives in
// `lib/moderationQueue.ts`, which reuses the shared row shapes but narrows
// `reportType`/`status` to precise unions. Report rows need that narrowing cast
// at the boundary; audit rows are structurally identical (ModerationAction =
// the shared shape), so they flow through untouched.

function toQueueReport(r: HookModerationReport): ModerationReport {
  return {
    ...r,
    reportType: r.reportType as ReportType,
    status: r.status as ReportStatus,
  };
}

/** Stable empty-array reference so audit-derived memos don't churn on refetch. */
const EMPTY_ACTIONS: readonly ModerationAction[] = [];

// --- Resolution vocabulary ------------------------------------------------
//
// The relay pairs `dismiss` with status `dismissed` and every other action
// with `resolved` (moderation_commands.rs: `(action == "dismiss") ==
// (status == "dismissed")`). Encode that pairing here so the UI can never
// submit an invalid combination.
function statusForAction(action: ResolutionAction): "resolved" | "dismissed" {
  return action === "dismiss" ? "dismissed" : "resolved";
}

/**
 * Resolve the author (signer) pubkey a member-directed enforcement acts on.
 * For a pubkey-target report that IS the target; for an event-target report the
 * report row carries only the event id (the reporter's `p` author tag is
 * dropped at ingest), so we read the reported event and take its signer — the
 * stored `pubkey` is signer truth, never a `p`/`actor` override. Throws if the
 * event can't be resolved (e.g. already deleted) so the caller aborts before
 * touching the 9044.
 */
async function resolveTargetAuthor(
  group: ModerationQueueGroup,
): Promise<string> {
  if (group.targetKind === "pubkey") return group.target;
  const event = await getEventById(group.target);
  if (!event?.pubkey) {
    throw new Error("Не удалось определить автора сообщения.");
  }
  return event.pubkey;
}

/**
 * Compose the enforcement event paired with a resolution, BEFORE the 9044.
 *
 * A 9044 resolve records the decision and DMs the reporter "reviewed and acted
 * on" — so it must not fire until the action actually happened. Enforce first;
 * on success the caller sends the 9044. On failure this throws and the caller
 * leaves the report open (no false DM, no orphan decision row). `escalate` and
 * `dismiss` carry no enforcement — they are pure 9044 decisions.
 */
async function enforceResolution(
  group: ModerationQueueGroup,
  action: ResolutionAction,
  ban: (input: { pubkey: string; reason?: string }) => Promise<unknown>,
): Promise<void> {
  switch (action) {
    case "delete":
      // Gated to event targets with a channel (resolvableActions).
      if (group.channelId == null)
        throw new Error("У жалобы отсутствует канал.");
      await deleteMessage(group.channelId, group.target);
      return;
    case "ban":
      await ban({ pubkey: await resolveTargetAuthor(group) });
      return;
    case "kick":
      // Gated to event targets with a channel (resolvableActions).
      if (group.channelId == null)
        throw new Error("У жалобы отсутствует канал.");
      await removeChannelMember(
        group.channelId,
        await resolveTargetAuthor(group),
      );
      return;
    case "escalate":
    case "dismiss":
      return;
    case "timeout":
      // Dropped from one-click until the resolve flow collects a duration.
      throw new Error("Тайм-аут пока недоступен из очереди.");
  }
}

const RESOLUTION_OPTIONS: {
  action: ResolutionAction;
  label: string;
  description: string;
}[] = [
  {
    action: "delete",
    label: "Удалить контент",
    description: "Удалить содержимое жалобы и закрыть её.",
  },
  {
    action: "kick",
    label: "Исключить автора",
    description: "Удалить автора из сообщества.",
  },
  {
    action: "ban",
    label: "Заблокировать автора",
    description: "Заблокировать автора в сообществе.",
  },
  {
    action: "timeout",
    label: "Заглушить автора",
    description: "Временно заглушить автора.",
  },
  {
    action: "escalate",
    label: "Эскалировать",
    description: "Передать в очередь по безопасности платформы.",
  },
  {
    action: "dismiss",
    label: "Отклонить",
    description: "Нарушений нет — закрыть без действий.",
  },
];

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const SEVERITY_BADGE: Record<SeverityTier, string> = {
  critical: "bg-destructive/15 text-destructive",
  high: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  normal: "bg-muted text-muted-foreground",
};

function targetLabel(group: ModerationQueueGroup): string {
  const short = truncatePubkey(group.target);
  switch (group.targetKind) {
    case "event":
      return `Сообщение ${short}`;
    case "pubkey":
      return `Участник ${short}`;
    case "blob":
      return `Вложение ${short}`;
  }
}

function ReporterLine({
  report,
  displayName,
}: {
  report: ModerationReport;
  displayName?: string | null;
}) {
  const who = displayName?.trim() || truncatePubkey(report.reporterPubkey);
  return (
    <div className="rounded-md border border-border/50 bg-background/50 px-2.5 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-medium">
          {reportTypeLabel(report.reportType)}
        </span>
        <span className="text-muted-foreground">
          от {who} · {formatTimestamp(report.createdAt)}
        </span>
      </div>
      {report.note ? (
        <p className="mt-1 text-xs text-muted-foreground">{report.note}</p>
      ) : null}
    </div>
  );
}

function ResolveMenu({
  allowed,
  disabled,
  onResolve,
}: {
  allowed: readonly ResolutionAction[];
  disabled: boolean;
  onResolve: (action: ResolutionAction) => void;
}) {
  const options = RESOLUTION_OPTIONS.filter((option) =>
    allowed.includes(option.action),
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          data-testid="moderation-resolve-trigger"
          disabled={disabled}
          size="sm"
          type="button"
        >
          Решить
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Решение</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuItem
            data-testid={`moderation-resolve-${option.action}`}
            key={option.action}
            onSelect={() => onResolve(option.action)}
          >
            <div className="flex flex-col">
              <span className="text-sm font-medium">{option.label}</span>
              <span className="text-xs text-muted-foreground">
                {option.description}
              </span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function QueueGroupCard({
  group,
  reporterNames,
  onResolve,
  disabled,
}: {
  group: ModerationQueueGroup;
  reporterNames: Record<string, string | null | undefined>;
  onResolve: (group: ModerationQueueGroup, action: ResolutionAction) => void;
  disabled: boolean;
}) {
  const topType = groupTopReportType(group);
  const tier = severityTier(topType);
  return (
    <div
      className="space-y-2.5 rounded-lg border border-border/60 bg-background/60 p-3"
      data-testid={`moderation-group-${group.targetKey}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                SEVERITY_BADGE[tier],
              )}
            >
              {tier === "critical" ? (
                <ShieldAlert className="mr-1 h-3 w-3" />
              ) : null}
              {reportTypeLabel(topType)}
            </span>
            <span className="truncate font-mono text-xs text-muted-foreground">
              {targetLabel(group)}
            </span>
            <span className="text-xs text-muted-foreground">
              · {group.reports.length}{" "}
              {group.reports.length === 1 ? "жалоба" : "жалоб"}
            </span>
          </div>
        </div>
        <div className="shrink-0">
          <ResolveMenu
            allowed={resolvableActions(
              group.targetKind,
              group.channelId != null,
            )}
            disabled={disabled}
            onResolve={(action) => onResolve(group, action)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        {group.reports.map((report) => (
          <ReporterLine
            displayName={reporterNames[report.reporterPubkey.toLowerCase()]}
            key={report.id}
            report={report}
          />
        ))}
      </div>

      {group.priorActions.length > 0 ? (
        <div className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {group.priorActions.length}{" "}
            {group.priorActions.length === 1
              ? "предыдущее действие"
              : "предыдущих действий"}{" "}
            в отношении этой цели
            {" — "}
            {group.priorActions
              .slice(0, 3)
              .map((a) => a.action)
              .join(", ")}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function QueueTab() {
  const reportsQuery = useModerationReportsQuery({ status: "open" });
  const auditQuery = useModerationAuditQuery();
  const resolveMutation = useResolveReportMutation();
  const banMutation = useBanMemberMutation();

  const groups = useMemo(() => {
    const reports = (reportsQuery.data ?? []).map(toQueueReport);
    return buildModerationQueue(reports, auditQuery.data ?? []);
  }, [reportsQuery.data, auditQuery.data]);

  const reporterPubkeys = useMemo(
    () =>
      groups.flatMap((group) =>
        group.reports.map((report) => report.reporterPubkey),
      ),
    [groups],
  );
  const reporterProfiles = useUsersBatchQuery(reporterPubkeys, {
    enabled: reporterPubkeys.length > 0,
  });
  const reporterNames = useMemo(() => {
    const map: Record<string, string | null | undefined> = {};
    const profiles = reporterProfiles.data?.profiles ?? {};
    for (const [pubkey, summary] of Object.entries(profiles)) {
      map[pubkey.toLowerCase()] = summary?.displayName ?? null;
    }
    return map;
  }, [reporterProfiles.data]);

  async function handleResolve(
    group: ModerationQueueGroup,
    action: ResolutionAction,
  ) {
    const status = statusForAction(action);
    const openReports = group.reports.filter(
      (report) => report.status === "open",
    );
    try {
      // Enforce FIRST. The 9044 resolve DMs the reporter "reviewed and acted
      // on" — if enforcement fails we must not send that lie, and we leave the
      // report open (retryable, no orphan decision row). Only after the paired
      // 9040/9005/9001 lands do we resolve every open report about this target.
      await enforceResolution(group, action, banMutation.mutateAsync);
      await Promise.all(
        openReports.map((report) =>
          resolveMutation.mutateAsync({
            reportEventId: report.reportEventId,
            status,
            action,
          }),
        ),
      );
      toast.success(
        status === "dismissed" ? "Жалоба отклонена" : "Жалоба решена",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось обработать жалобу",
      );
    }
  }

  if (reportsQuery.error instanceof Error) {
    return (
      <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {reportsQuery.error.message}
      </p>
    );
  }
  if (reportsQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Загрузка жалоб…</p>;
  }
  if (groups.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border/70 bg-background/40 px-3 py-6 text-center text-sm text-muted-foreground">
        Нет открытых жалоб. Очередь пуста.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <QueueGroupCard
          disabled={resolveMutation.isPending || banMutation.isPending}
          group={group}
          key={group.targetKey}
          onResolve={handleResolve}
          reporterNames={reporterNames}
        />
      ))}
    </div>
  );
}

function AuditRow({
  action,
  actorName,
}: {
  action: ModerationAction;
  actorName?: string | null;
}) {
  const who = actorName?.trim() || truncatePubkey(action.actorPubkey);
  const targetShort = action.targetPubkey
    ? truncatePubkey(action.targetPubkey)
    : action.targetEventId
      ? truncatePubkey(action.targetEventId)
      : null;
  return (
    <div
      className="space-y-1 rounded-lg border border-border/60 bg-background/60 px-3 py-2"
      data-testid={`moderation-audit-${action.id}`}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="font-medium capitalize">
          {action.action.replace(/_/g, " ")}
        </span>
        {targetShort ? (
          <span className="font-mono text-xs text-muted-foreground">
            → {targetShort}
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground">
          от {who} · {formatTimestamp(action.createdAt)}
        </span>
      </div>
      {action.publicReason ? (
        <p className="text-xs text-muted-foreground">{action.publicReason}</p>
      ) : null}
    </div>
  );
}

function AuditTab() {
  const auditQuery = useModerationAuditQuery();

  const actions = auditQuery.data ?? EMPTY_ACTIONS;

  const actorPubkeys = useMemo(
    () => actions.map((action) => action.actorPubkey),
    [actions],
  );
  const actorProfiles = useUsersBatchQuery(actorPubkeys, {
    enabled: actorPubkeys.length > 0,
  });
  const actorNames = useMemo(() => {
    const map: Record<string, string | null | undefined> = {};
    const profiles = actorProfiles.data?.profiles ?? {};
    for (const [pubkey, summary] of Object.entries(profiles)) {
      map[pubkey.toLowerCase()] = summary?.displayName ?? null;
    }
    return map;
  }, [actorProfiles.data]);

  if (auditQuery.error instanceof Error) {
    return (
      <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {auditQuery.error.message}
      </p>
    );
  }
  if (auditQuery.isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Загрузка журнала аудита…</p>
    );
  }
  if (actions.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border/70 bg-background/40 px-3 py-6 text-center text-sm text-muted-foreground">
        Пока нет действий модерации.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {actions.map((action) => (
        <AuditRow
          action={action}
          actorName={actorNames[action.actorPubkey.toLowerCase()]}
          key={action.id}
        />
      ))}
    </div>
  );
}

export function ModerationQueueCard() {
  const membershipQuery = useMyRelayMembershipQuery();
  const role = membershipQuery.data?.role;
  const isModerator = role === "owner" || role === "admin";

  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      data-testid="settings-moderation"
    >
      <SettingsSectionHeader
        title="Модерация"
        description="Просматривайте жалобы на контент и принимайте меры. Видно только модераторам сообщества."
      />

      {!isModerator ? (
        membershipQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Проверка доступа…</p>
        ) : (
          <p className="rounded-lg border border-dashed border-border/70 bg-background/40 px-3 py-6 text-center text-sm text-muted-foreground">
            Очередь модерации доступна только модераторам сообщества.
          </p>
        )
      ) : (
        <Tabs defaultValue="queue">
          <TabsList>
            <TabsTrigger data-testid="moderation-tab-queue" value="queue">
              Очередь
            </TabsTrigger>
            <TabsTrigger data-testid="moderation-tab-audit" value="audit">
              Журнал аудита
            </TabsTrigger>
          </TabsList>
          <TabsContent value="queue">
            <QueueTab />
          </TabsContent>
          <TabsContent value="audit">
            <AuditTab />
          </TabsContent>
        </Tabs>
      )}
    </section>
  );
}
