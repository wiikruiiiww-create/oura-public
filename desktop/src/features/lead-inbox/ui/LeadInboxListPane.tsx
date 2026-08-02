import * as React from "react";

import type { LeadInboxItem } from "@/features/lead-inbox/lib/leadInboxItems";
import { TopChromeInsetHeader } from "@/shared/layout/TopChromeInsetHeader";
import { cn } from "@/shared/lib/cn";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { VirtualizedList } from "@/shared/ui/VirtualizedList";

type LeadInboxListPaneProps = {
  items: LeadInboxItem[];
  isLoading: boolean;
  errorMessage?: string;
  onOpenChannel: (channelId: string) => void;
};

/**
 * Список обращений: одна карточка = одна комната лида. Клик открывает саму
 * комнату (ChannelPane), поэтому детальной панели у экрана нет — в отличие от
 * `features/home/ui/InboxListPane`, откуда взята презентационная часть строки.
 */
export function LeadInboxListPane({
  items,
  isLoading,
  errorMessage,
  onOpenChannel,
}: LeadInboxListPaneProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const renderItem = (item: LeadInboxItem) => (
    <button
      className="group/lead-item relative block w-full cursor-pointer px-3 py-4 text-left transition-colors hover:bg-muted/25 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
      data-testid={`lead-inbox-item-${item.channelId}`}
      onClick={() => onOpenChannel(item.channelId)}
      type="button"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <UserAvatar
          avatarUrl={null}
          className="h-9 w-9 shrink-0"
          displayName={item.leadName}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            <span className="block min-w-0 flex-1 truncate text-sm font-semibold leading-4 text-foreground">
              {item.leadName}
            </span>
            <span
              className={cn(
                "flex shrink-0 items-center gap-1.5 text-xs leading-4 text-muted-foreground/70",
                item.isUnread ? "font-medium" : "font-normal",
              )}
            >
              {item.isUnread ? (
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-primary"
                  data-testid={`lead-inbox-unread-${item.channelId}`}
                />
              ) : null}
              {item.timestampLabel}
            </span>
          </div>

          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-2xs leading-3">
            <span className="shrink-0 font-medium text-muted-foreground/80">
              {item.sourceLabel}
            </span>
            {item.isNew ? (
              <span
                className="inline-flex shrink-0 items-center rounded-full bg-primary/10 px-1.5 text-2xs font-semibold leading-4 text-primary"
                data-testid={`lead-inbox-new-${item.channelId}`}
              >
                новый
              </span>
            ) : null}
          </div>

          <p
            className={cn(
              "mt-1.5 truncate text-sm leading-5",
              item.isUnread
                ? "font-semibold text-foreground"
                : "font-normal text-muted-foreground",
            )}
          >
            {item.preview || "Сообщений пока нет"}
          </p>
        </div>
      </div>
    </button>
  );

  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background/60">
      <TopChromeInsetHeader flush transparent>
        <div className="px-5 py-2">
          <div className="flex min-h-9 w-full min-w-0 items-center justify-between gap-3">
            <span className="text-sm font-medium text-foreground">
              Обращения
            </span>
            {items.length > 0 ? (
              <span
                className="text-xs text-muted-foreground"
                data-testid="lead-inbox-count"
              >
                {items.length}
              </span>
            ) : null}
          </div>
        </div>
      </TopChromeInsetHeader>

      <div
        className="-mt-13 min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain pt-13"
        data-testid="lead-inbox-list"
        ref={scrollRef}
      >
        {errorMessage ? (
          <div className="flex h-full min-h-64 items-center justify-center px-6 text-center">
            <div>
              <p className="text-sm font-medium text-foreground">
                Не удалось загрузить обращения
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {errorMessage}
              </p>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full min-h-64 items-center justify-center px-6 text-center">
            <div>
              <p className="text-sm font-medium text-foreground">
                {isLoading ? "Загружаем обращения…" : "Обращений пока нет"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {isLoading
                  ? "Секунду."
                  : "Новое обращение появится здесь, как только клиент напишет во внешний канал."}
              </p>
            </div>
          </div>
        ) : (
          <VirtualizedList
            estimateSize={96}
            getItemKey={(item) => item.channelId}
            items={items}
            renderItem={renderItem}
            scrollRef={scrollRef}
          />
        )}
      </div>
    </section>
  );
}
