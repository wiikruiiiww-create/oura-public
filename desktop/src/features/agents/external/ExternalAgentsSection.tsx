import { Bot } from "lucide-react";

import { Badge } from "@/shared/ui/badge";

import type { ExternalAgentRecord } from "./externalAgent";

const ROLE_LABELS: Record<string, string> = {
  sales: "Продажи",
  consultant: "Консультация",
  recruiter: "Подбор персонала",
  support: "Поддержка",
};

/** Бейдж типа агента — на карточках внутренних и внешних агентов. */
export function AgentKindBadge({ kind }: { kind: "internal" | "external" }) {
  return kind === "external" ? (
    <Badge variant="info">Внешний</Badge>
  ) : (
    <Badge variant="secondary">Внутренний</Badge>
  );
}

/**
 * Внешние агенты показываются отдельной секцией: они не запускаются на этом
 * компьютере и не добавляются в командные каналы, поэтому действия карточек
 * внутренних агентов (запуск, перезапуск) к ним неприменимы.
 */
export function ExternalAgentsSection({
  agents,
}: {
  agents: ExternalAgentRecord[];
}) {
  if (agents.length === 0) return null;

  return (
    <section className="space-y-2" data-testid="external-agents-section">
      <h3 className="text-sm font-medium text-muted-foreground">
        Внешние агенты
      </h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {agents.map((agent) => (
          <article
            className="flex flex-col gap-2 rounded-2xl border border-border/70 bg-card p-3"
            data-testid={`external-agent-${agent.agentId}`}
            key={agent.agentId}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-medium">
                  {agent.name || agent.profile.goal || "Без имени"}
                </span>
              </div>
              <AgentKindBadge kind="external" />
            </div>
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {agent.profile.goal}
            </p>
            <div className="flex items-center gap-2 text-2xs text-muted-foreground">
              <span>
                {ROLE_LABELS[agent.profile.role] ?? agent.profile.role}
              </span>
              <span aria-hidden>·</span>
              <span>Telegram</span>
              {agent.isActive ? null : (
                <>
                  <span aria-hidden>·</span>
                  <span>выключен</span>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
