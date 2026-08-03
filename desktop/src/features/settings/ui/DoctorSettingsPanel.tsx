import * as React from "react";
import { EllipsisVertical, ExternalLink, RefreshCw } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

import {
  useAcpAuthMethodsQuery,
  useAcpRuntimesQuery,
  useConnectAcpRuntimeMutation,
  useGitBashPrerequisiteQuery,
  useInstallAcpRuntimeMutation,
} from "@/features/agents/hooks";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import type { AcpAuthMethod, AcpRuntimeCatalogEntry } from "@/shared/api/types";
import { getInstallErrorMessage } from "@/shared/lib/installError";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { SectionHeader } from "@/shared/ui/PageHeader";
import { Spinner } from "@/shared/ui/spinner";
import { Switch } from "@/shared/ui/switch";

const RUNTIME_LOGO_URLS: Record<string, string> = {
  "buzz-agent": "/app-icon@2x.png",
  claude: "/runtime-icons/claude.png",
  codex: "/runtime-icons/codex.png",
  goose: "/runtime-icons/goose.svg",
};

const RUNTIME_LOGO_SCALE: Record<string, string> = {
  "buzz-agent": "scale-110",
  claude: "scale-110",
  codex: "scale-110",
  goose: "scale-125",
};

const RUNTIME_SORT_PRIORITY: Record<string, number> = {
  "buzz-agent": 0,
  goose: 1,
};

function runtimeInstallGuideLabel(runtime: AcpRuntimeCatalogEntry) {
  return runtime.availability === "adapter_missing" ||
    runtime.availability === "adapter_outdated"
    ? "Руководство по установке адаптера"
    : "Руководство по настройке CLI";
}

function RuntimeLogo({ runtime }: { runtime: AcpRuntimeCatalogEntry }) {
  const avatarUrl = RUNTIME_LOGO_URLS[runtime.id] ?? runtime.avatarUrl;

  return (
    <ProfileAvatar
      avatarUrl={avatarUrl}
      className="h-9 w-9 rounded-xl bg-background shadow-none"
      imageClassName={RUNTIME_LOGO_SCALE[runtime.id]}
      label={runtime.label}
      testId={`doctor-runtime-logo-${runtime.id}`}
    />
  );
}

function RuntimeOverflowMenu({
  authMethods,
  connectingMethodId,
  isConnecting,
  onConnect,
  runtime,
}: {
  authMethods: AcpAuthMethod[];
  connectingMethodId: string | null;
  isConnecting: boolean;
  onConnect: (method: AcpAuthMethod) => void;
  runtime: AcpRuntimeCatalogEntry;
}) {
  const hasInstructions =
    runtime.installInstructionsUrl.trim().length > 0 &&
    (runtime.availability !== "available" ||
      runtime.authStatus.status === "logged_out" ||
      runtime.authStatus.status === "config_invalid");
  const hasActions =
    runtime.nodeRequired || hasInstructions || authMethods.length > 0;

  if (!hasActions) {
    return null;
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`Открыть действия для ${runtime.label}`}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          data-testid={`doctor-runtime-menu-${runtime.id}`}
          type="button"
        >
          <EllipsisVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {authMethods.map((method) => (
          <DropdownMenuItem
            disabled={isConnecting}
            key={method.id}
            onSelect={() => onConnect(method)}
          >
            {isConnecting && connectingMethodId === method.id ? (
              <Spinner aria-hidden className="h-4 w-4 border-2" />
            ) : null}
            {method.name || method.id}
          </DropdownMenuItem>
        ))}
        {runtime.nodeRequired ? (
          <DropdownMenuItem onSelect={() => void openUrl("https://nodejs.org")}>
            <ExternalLink className="h-4 w-4" />
            Установить Node.js
          </DropdownMenuItem>
        ) : null}
        {hasInstructions ? (
          <DropdownMenuItem
            onSelect={() => void openUrl(runtime.installInstructionsUrl)}
          >
            <ExternalLink className="h-4 w-4" />
            {runtimeInstallGuideLabel(runtime)}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RuntimeActions({
  authMethods,
  connectingMethodId,
  isConnecting,
  isInstalling,
  onConnect,
  onInstall,
  runtime,
}: {
  authMethods: AcpAuthMethod[];
  connectingMethodId: string | null;
  isConnecting: boolean;
  isInstalling: boolean;
  onConnect: (method: AcpAuthMethod) => void;
  onInstall: () => void;
  runtime: AcpRuntimeCatalogEntry;
}) {
  const isAvailable = runtime.availability === "available";
  const canInstall = runtime.canAutoInstall && !runtime.nodeRequired;
  const isWorking = isInstalling || isConnecting;

  return (
    <div className="ml-auto flex shrink-0 items-center justify-end gap-1">
      <RuntimeOverflowMenu
        authMethods={authMethods}
        connectingMethodId={connectingMethodId}
        isConnecting={isConnecting}
        onConnect={onConnect}
        runtime={runtime}
      />
      {isWorking ? (
        <div className="flex h-5 w-9 items-center justify-center text-muted-foreground">
          <Spinner
            aria-label={`${runtime.label} ${isInstalling ? "установка" : "подключение"}`}
            className="h-4 w-4 border-2"
            data-testid={`doctor-runtime-loading-${runtime.id}`}
          />
        </div>
      ) : (
        <Switch
          aria-label={`Доступность ${runtime.label}`}
          checked={isAvailable}
          className="disabled:cursor-default disabled:opacity-100"
          data-testid={`doctor-runtime-toggle-${runtime.id}`}
          disabled={isAvailable || !canInstall}
          onCheckedChange={(checked) => {
            if (checked) {
              onInstall();
            }
          }}
        />
      )}
    </div>
  );
}

function RuntimeStatusChip({ runtime }: { runtime: AcpRuntimeCatalogEntry }) {
  const label =
    runtime.authStatus.status === "config_invalid"
      ? "Ошибка конфигурации"
      : runtime.availability === "adapter_missing"
        ? "Нужен адаптер"
        : runtime.availability === "adapter_outdated"
          ? "Нужно обновление"
          : runtime.availability === "cli_missing" ||
              runtime.availability === "not_installed"
            ? "Нужен CLI"
            : null;

  if (!label) {
    return null;
  }

  const isConfigError = runtime.authStatus.status === "config_invalid";

  return (
    <>
      <span aria-hidden="true" className="text-muted-foreground/50">
        ·
      </span>
      <span
        className={cn(
          "inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-medium",
          isConfigError
            ? "bg-destructive/10 text-destructive"
            : "bg-muted text-muted-foreground",
        )}
        data-testid={`doctor-runtime-status-${runtime.id}`}
      >
        {label}
      </span>
    </>
  );
}

function RuntimeHeader({
  authMethods,
  connectingMethodId,
  isConnecting,
  isInstalling,
  onConnect,
  onInstall,
  runtime,
}: {
  authMethods: AcpAuthMethod[];
  connectingMethodId: string | null;
  isConnecting: boolean;
  isInstalling: boolean;
  onConnect: (method: AcpAuthMethod) => void;
  onInstall: () => void;
  runtime: AcpRuntimeCatalogEntry;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <RuntimeLogo runtime={runtime} />
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="min-w-0 text-sm font-medium">{runtime.label}</p>
          <RuntimeStatusChip runtime={runtime} />
        </div>
      </div>
      <RuntimeActions
        authMethods={authMethods}
        connectingMethodId={connectingMethodId}
        isConnecting={isConnecting}
        isInstalling={isInstalling}
        onConnect={onConnect}
        onInstall={onInstall}
        runtime={runtime}
      />
    </div>
  );
}

function RuntimeRow({
  resetEpoch,
  runtime,
}: {
  resetEpoch: number;
  runtime: AcpRuntimeCatalogEntry;
}) {
  const [terminalLaunchMethodId, setTerminalLaunchMethodId] = React.useState<
    string | null
  >(null);
  const [isUpdateWarningOpen, setIsUpdateWarningOpen] = React.useState(false);
  // Each row owns its mutation instance so concurrent installs each track
  // their own isPending / result state independently.
  const installMutation = useInstallAcpRuntimeMutation();
  const [installResult, setInstallResult] = React.useState<{
    success: boolean;
    error: string | null;
  } | null>(null);
  // Clear stale install results when the parent triggers a catalog refresh
  // (Check again) — the runtime may now be healthy and stale failure state
  // would linger because keyed rows don't remount on refetch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetEpoch is an intentional trigger only; its value is not consumed in the effect body
  React.useEffect(() => {
    setInstallResult(null);
  }, [resetEpoch]);
  const isInstalling = installMutation.isPending;
  const installError = installResult?.error ?? null;

  function handleInstall() {
    setInstallResult(null);
    installMutation.mutate(runtime.id, {
      onSuccess: (result) => {
        if (result.success) {
          setInstallResult({ success: true, error: null });
        } else {
          setInstallResult({
            success: false,
            error: getInstallErrorMessage(result.steps),
          });
        }
      },
      onError: (error) => {
        setInstallResult({
          success: false,
          error:
            error instanceof Error ? error.message : "Не удалось установить.",
        });
      },
    });
  }

  const canConnectAccount =
    runtime.availability === "available" &&
    runtime.authStatus.status === "logged_out";
  const authMethodsQuery = useAcpAuthMethodsQuery(runtime.id, {
    enabled: canConnectAccount,
  });
  const authMethods = canConnectAccount
    ? (authMethodsQuery.data?.methods ?? [])
    : [];
  const connectMutation = useConnectAcpRuntimeMutation();
  const connectionError = connectMutation.error
    ? `Не удалось подключить ${runtime.label}: ${
        connectMutation.error instanceof Error
          ? connectMutation.error.message
          : "Не удалось подключиться."
      }`
    : authMethodsQuery.error
      ? `Не удалось загрузить варианты входа: ${
          authMethodsQuery.error instanceof Error
            ? authMethodsQuery.error.message
            : "Запрос не выполнен."
        }`
      : null;

  return (
    <div
      className="min-h-16 rounded-2xl border border-border/60 bg-muted/20 px-4 py-3.5 text-sm"
      data-testid={`doctor-runtime-${runtime.id}`}
    >
      <div className="min-w-0">
        <RuntimeHeader
          authMethods={authMethods}
          connectingMethodId={connectMutation.variables?.methodId ?? null}
          isConnecting={connectMutation.isPending}
          isInstalling={isInstalling}
          onConnect={(method) => {
            setTerminalLaunchMethodId(null);
            connectMutation.mutate(
              {
                runtimeId: runtime.id,
                methodId: method.id,
              },
              {
                onSuccess: (result) => {
                  if (result.launched && method.type === "terminal") {
                    setTerminalLaunchMethodId(method.id);
                  }
                },
              },
            );
          }}
          onInstall={() => {
            if (runtime.availability === "adapter_outdated") {
              setIsUpdateWarningOpen(true);
              return;
            }
            handleInstall();
          }}
          runtime={runtime}
        />

        {runtime.availability !== "available" ? (
          <div
            className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground"
            data-testid={`doctor-runtime-guidance-${runtime.id}`}
          >
            <p>{runtime.installHint}</p>
            {runtime.installInstructionsUrl.trim().length > 0 ? (
              <button
                className="inline-flex shrink-0 items-center gap-1 underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => void openUrl(runtime.installInstructionsUrl)}
                type="button"
              >
                <ExternalLink className="h-4 w-4" />
                {runtimeInstallGuideLabel(runtime)}
              </button>
            ) : null}
          </div>
        ) : null}

        {runtime.authStatus.status === "config_invalid" ? (
          <p
            className="mt-2 whitespace-pre-line rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-sm text-destructive"
            data-testid={`doctor-runtime-config-error-${runtime.id}`}
          >
            Ошибка конфигурации: {runtime.authStatus.diagnostic}
          </p>
        ) : null}

        {installError ? (
          <p
            className="mt-2 whitespace-pre-line rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-sm text-destructive"
            data-testid={`doctor-runtime-install-error-${runtime.id}`}
          >
            {installError}
          </p>
        ) : null}
        {connectionError ? (
          <p
            className="mt-2 whitespace-pre-line rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-sm text-destructive"
            data-testid={`doctor-runtime-error-${runtime.id}`}
          >
            {connectionError}
          </p>
        ) : null}
        {canConnectAccount && terminalLaunchMethodId ? (
          <p
            className="mt-2 rounded-lg border border-border/60 bg-background/60 px-3 py-1.5 text-sm text-muted-foreground"
            data-testid={`doctor-runtime-terminal-guidance-${runtime.id}`}
          >
            Завершите вход в окне терминала, затем нажмите «Проверить снова»,
            чтобы перепроверить {runtime.label}.
          </p>
        ) : null}
      </div>
      <AlertDialog
        onOpenChange={setIsUpdateWarningOpen}
        open={isUpdateWarningOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Обновить адаптер {runtime.label}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Это заменит адаптер codex-acp на уровне всей системы. Более старые
              версии OURA, использующие устаревший адаптер, могут потерять
              доступ к сообществу, пока не будет восстановлен
              @zed-industries/codex-acp@0.16.0.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleInstall}
              data-testid={`doctor-runtime-confirm-update-${runtime.id}`}
            >
              Обновить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function GitBashCard({
  prerequisite,
}: {
  prerequisite: NonNullable<
    ReturnType<typeof useGitBashPrerequisiteQuery>["data"]
  >;
}) {
  return (
    <div
      className={cn(
        "min-h-16 rounded-2xl border px-4 py-4 text-sm",
        prerequisite.available
          ? "border-border/60 bg-muted/20"
          : "border-amber-500/20 bg-amber-500/5",
      )}
      data-testid="doctor-git-bash"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="text-sm font-medium">Git Bash</p>
            <span aria-hidden="true" className="text-muted-foreground/50">
              ·
            </span>
            <span
              className={cn(
                "inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-medium",
                prerequisite.available
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
              )}
            >
              {prerequisite.available ? "Доступно" : "Нужно действие"}
            </span>
          </div>
          {!prerequisite.available ? (
            <button
              className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => void openUrl(prerequisite.installInstructionsUrl)}
              type="button"
            >
              <ExternalLink className="h-4 w-4" /> Установить Git for Windows
            </button>
          ) : null}
        </div>
        {!prerequisite.available ? (
          <div className="mt-3 space-y-1 text-sm text-muted-foreground">
            <p>Требуется для инструментов оболочки buzz-agent в Windows.</p>
            <p>{prerequisite.installHint}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function DoctorSettingsPanel() {
  const runtimesQuery = useAcpRuntimesQuery();
  const gitBashQuery = useGitBashPrerequisiteQuery();
  const runtimes = React.useMemo(
    () =>
      [...(runtimesQuery.data ?? [])].sort(
        (left, right) =>
          (RUNTIME_SORT_PRIORITY[left.id] ?? Number.MAX_SAFE_INTEGER) -
          (RUNTIME_SORT_PRIORITY[right.id] ?? Number.MAX_SAFE_INTEGER),
      ),
    [runtimesQuery.data],
  );
  const isRefreshing = runtimesQuery.isFetching;
  // Incremented each time the user clicks "Check again" so RuntimeRow
  // useEffect clears stale install results from before the refresh.
  const [resetEpoch, setResetEpoch] = React.useState(0);

  return (
    <section
      className="min-w-0 space-y-4"
      data-testid="settings-agent-runtimes"
    >
      <SectionHeader
        className="items-center"
        title="Среды выполнения агентов"
        description="Выберите, какие инструменты агентов может использовать OURA на этом устройстве."
        action={
          <Button
            disabled={isRefreshing}
            onClick={() => {
              setResetEpoch((e) => e + 1);
              void runtimesQuery.refetch();
              void gitBashQuery.refetch();
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCw
              className={cn("h-4 w-4", isRefreshing && "animate-spin")}
            />
            Проверить снова
          </Button>
        }
      />

      <div className="space-y-8">
        {gitBashQuery.data ? (
          <section>
            <div className="mb-3 text-sm">
              <h2 className="text-lg font-semibold tracking-tight">
                Системные требования
              </h2>
              <p className="mt-1 text-sm font-normal text-muted-foreground">
                Инструменты Windows, необходимые поддерживаемым агентам.
              </p>
            </div>
            <GitBashCard prerequisite={gitBashQuery.data} />
          </section>
        ) : null}

        <section aria-label="Поддерживаемые среды выполнения агентов">
          {runtimesQuery.isLoading ? (
            <div className="rounded-2xl bg-muted/20 px-4 py-4 text-sm font-normal text-muted-foreground">
              Проверка сред выполнения агентов…
            </div>
          ) : runtimes.length > 0 ? (
            <div className="space-y-3" data-testid="doctor-runtime-list">
              {runtimes.map((runtime) => (
                <RuntimeRow
                  key={runtime.id}
                  resetEpoch={resetEpoch}
                  runtime={runtime}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-amber-500/10 px-4 py-4 text-sm text-warning">
              Поддерживаемые среды выполнения агентов не найдены.
            </div>
          )}

          {runtimesQuery.error instanceof Error ? (
            <p className="mt-3 rounded-2xl bg-destructive/10 px-4 py-4 text-sm text-destructive">
              {runtimesQuery.error.message}
            </p>
          ) : null}
        </section>
      </div>
    </section>
  );
}
