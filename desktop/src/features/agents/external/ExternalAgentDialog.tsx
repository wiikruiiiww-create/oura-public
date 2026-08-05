import { Check, Loader2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import { validateTelegramBotToken } from "@/shared/api/tauri";

import type { AgentKind } from "./AgentKindSelector";
import { AgentKindSelector } from "./AgentKindSelector";
import type { ExternalAgentDraft } from "./externalAgent";
import {
  canSubmitExternalAgent,
  emptyExternalAgentForm,
  externalAgentDraftFromForm,
  type ExternalAgentForm,
  tokenCheckReducer,
} from "./externalAgentFormState";

const ROLE_OPTIONS = [
  { value: "sales", label: "Продажи" },
  { value: "consultant", label: "Консультация" },
  { value: "recruiter", label: "Подбор персонала" },
  { value: "support", label: "Поддержка" },
] as const;

const FORMALITY_OPTIONS = [
  { value: "formal", label: "На «вы», официально" },
  { value: "friendly", label: "Дружелюбно" },
  { value: "casual", label: "Неформально" },
] as const;

const LENGTH_OPTIONS = [
  { value: "very_short", label: "Одно предложение" },
  { value: "short", label: "Коротко (1–3 предложения)" },
  { value: "medium", label: "Средне (3–5 предложений)" },
  { value: "long", label: "Развёрнуто" },
] as const;

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs";

/**
 * Форма создания внешнего агента: цель и тон определяют его поведение,
 * источник — куда он подключается. Токен бота проверяется до сохранения и
 * уходит на relay уже шифртекстом (шифрование делает вызывающий).
 */
export function ExternalAgentDialog({
  agentKind,
  onAgentKindChange,
  onOpenChange,
  onSubmit,
  isPending = false,
  error = null,
  leadServicePubkey,
  newAgentId,
}: {
  agentKind: AgentKind;
  onAgentKindChange: (next: AgentKind) => void;
  onOpenChange: (open: boolean) => void;
  /** Шифрует токен и публикует описание; текст токена дальше формы не уходит. */
  onSubmit: (
    draft: Omit<ExternalAgentDraft, "botTokenEnc" | "bridgePubkey">,
    token: string,
  ) => Promise<boolean>;
  isPending?: boolean;
  error?: Error | null;
  /** hex-ключ сервиса лидов из настроек сообщества; null — внешних создавать нельзя */
  leadServicePubkey: string | null;
  newAgentId: string;
}) {
  const [form, setForm] = React.useState<ExternalAgentForm>(
    emptyExternalAgentForm,
  );
  const patch = React.useCallback((next: Partial<ExternalAgentForm>) => {
    setForm((prev) => ({ ...prev, ...next }));
  }, []);

  const gate = canSubmitExternalAgent(form, leadServicePubkey);
  const tokenCheck = form.tokenCheck;

  const handleCheckToken = React.useCallback(async () => {
    setForm((prev) => ({
      ...prev,
      tokenCheck: tokenCheckReducer(prev.tokenCheck, { type: "check-started" }),
    }));
    const token = form.token.trim();
    try {
      const identity = await validateTelegramBotToken(token);
      setForm((prev) => ({
        ...prev,
        tokenCheck: tokenCheckReducer(prev.tokenCheck, {
          type: "check-succeeded",
          username: identity.username,
          botId: identity.botId,
          token,
        }),
      }));
    } catch (checkError) {
      setForm((prev) => ({
        ...prev,
        tokenCheck: tokenCheckReducer(prev.tokenCheck, {
          type: "check-failed",
          error:
            checkError instanceof Error
              ? checkError.message
              : String(checkError),
        }),
      }));
    }
  }, [form.token]);

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!gate.ok || isPending) return;
      const draft = externalAgentDraftFromForm(form, {
        agentId: newAgentId,
        botTokenEnc: "",
        bridgePubkey: "",
      });
      const { botTokenEnc: _enc, bridgePubkey: _bridge, ...rest } = draft;
      const submitted = await onSubmit(rest, form.token.trim());
      if (submitted) onOpenChange(false);
    },
    [form, gate.ok, isPending, newAgentId, onOpenChange, onSubmit],
  );

  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Новый агент</DialogTitle>
          <DialogDescription>
            Внешний агент отвечает обращениям клиентов в комнатах лидов.
          </DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
          <AgentKindSelector
            disabled={isPending}
            onChange={onAgentKindChange}
            value={agentKind}
          />

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="external-goal">
              Цель агента *
            </label>
            <Input
              disabled={isPending}
              id="external-goal"
              onChange={(e) => patch({ goal: e.target.value })}
              placeholder="Например: записать на консультацию"
              value={form.goal}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="external-name">
              Имя
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                (необязательно — возьмём из цели)
              </span>
            </label>
            <Input
              disabled={isPending}
              id="external-name"
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Продавец"
              value={form.name}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="external-role">
                Роль
              </label>
              <select
                className={SELECT_CLASS}
                disabled={isPending}
                id="external-role"
                onChange={(e) =>
                  patch({ role: e.target.value as ExternalAgentForm["role"] })
                }
                value={form.role}
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label
                className="text-sm font-medium"
                htmlFor="external-formality"
              >
                Тон
              </label>
              <select
                className={SELECT_CLASS}
                disabled={isPending}
                id="external-formality"
                onChange={(e) =>
                  patch({
                    formality: e.target.value as ExternalAgentForm["formality"],
                  })
                }
                value={form.formality}
              >
                {FORMALITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="external-length">
                Длина ответов
              </label>
              <select
                className={SELECT_CLASS}
                disabled={isPending}
                id="external-length"
                onChange={(e) =>
                  patch({
                    maxLength: e.target.value as ExternalAgentForm["maxLength"],
                  })
                }
                value={form.maxLength}
              >
                {LENGTH_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="external-emojis">
                Эмодзи на сообщение: {form.maxEmojis}
              </label>
              <input
                className="w-full accent-primary"
                disabled={isPending}
                id="external-emojis"
                max={5}
                min={0}
                onChange={(e) => patch({ maxEmojis: Number(e.target.value) })}
                type="range"
                value={form.maxEmojis}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="external-audience">
              Целевая аудитория
            </label>
            <Textarea
              disabled={isPending}
              id="external-audience"
              onChange={(e) => patch({ audience: e.target.value })}
              placeholder="Кто ваши клиенты, что для них важно"
              rows={2}
              value={form.audience}
            />
          </div>

          <div className="space-y-1.5">
            <label
              className="text-sm font-medium"
              htmlFor="external-instructions"
            >
              Дополнительные правила
            </label>
            <Textarea
              disabled={isPending}
              id="external-instructions"
              onChange={(e) => patch({ instructions: e.target.value })}
              placeholder="Чего агент не должен делать, особые условия"
              rows={2}
              value={form.instructions}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="external-knowledge">
              База знаний
            </label>
            <Textarea
              disabled={isPending}
              id="external-knowledge"
              onChange={(e) => patch({ knowledge: e.target.value })}
              placeholder="Цены, услуги, режим работы — то, на что агент опирается в ответах"
              rows={3}
              value={form.knowledge}
            />
          </div>

          <div className="space-y-1.5 rounded-xl border border-border/70 bg-muted/20 p-3">
            <label className="text-sm font-medium" htmlFor="external-token">
              Источник обращений — Telegram
            </label>
            <p className="text-xs text-muted-foreground">
              Создайте бота у @BotFather и вставьте его токен.
            </p>
            <div className="flex gap-2">
              <Input
                autoComplete="off"
                data-testid="external-agent-token"
                disabled={isPending}
                id="external-token"
                onChange={(e) => {
                  setForm((prev) => ({
                    ...prev,
                    token: e.target.value,
                    tokenCheck: tokenCheckReducer(prev.tokenCheck, {
                      type: "token-edited",
                    }),
                  }));
                }}
                placeholder="123456789:AA…"
                type="password"
                value={form.token}
              />
              <Button
                disabled={
                  isPending ||
                  form.token.trim().length === 0 ||
                  tokenCheck.status === "checking"
                }
                onClick={() => void handleCheckToken()}
                type="button"
                variant="outline"
              >
                {tokenCheck.status === "checking" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Проверить"
                )}
              </Button>
            </div>
            {tokenCheck.status === "ok" ? (
              <p className="flex items-center gap-1.5 text-xs text-success">
                <Check className="h-3.5 w-3.5" />@{tokenCheck.username}{" "}
                подключён
              </p>
            ) : null}
            {tokenCheck.status === "error" ? (
              <p className="text-xs text-destructive">{tokenCheck.error}</p>
            ) : null}
          </div>

          {leadServicePubkey ? null : (
            <p className="rounded-xl border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning">
              В настройках сообщества не задан сервис лидов — без него токен
              бота некому передать.
            </p>
          )}

          {error ? (
            <p className="text-sm text-destructive">{error.message}</p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Отмена
            </Button>
            <Button
              data-testid="external-agent-submit"
              disabled={!gate.ok || isPending}
              title={gate.ok ? undefined : gate.reason}
              type="submit"
            >
              {isPending ? "Создаём…" : "Создать агента"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
