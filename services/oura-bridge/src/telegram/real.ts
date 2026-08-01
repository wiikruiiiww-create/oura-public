import { Bot } from "grammy";
import type {
  InboundMessage,
  InboundSource,
  OutboundMessage,
  OutboundSink,
} from "../types.js";
import { PermanentDeliveryError } from "../types.js";
import { chunkText, isRetryable, sendWithRetry, toInbound } from "./helpers.js";

/**
 * Реальный Telegram-канал (long-polling через grammy). Реализует те же интерфейсы, что StubTelegram.
 */
export class TelegramChannel implements InboundSource, OutboundSink {
  private readonly bot: Bot;

  constructor(token: string) {
    this.bot = new Bot(token);
  }

  async start(onMessage: (m: InboundMessage) => Promise<void>): Promise<void> {
    // fail-fast: мёртвый/отозванный токен обнаруживаем на старте,
    // а не при первом сообщении клиента
    const me = await this.bot.api.getMe();
    console.log(`[telegram] бот @${me.username} (id ${me.id})`);

    this.bot.on("message:text", async (ctx) => {
      try {
        await onMessage(toInbound(ctx.message));
      } catch (e) {
        console.error(
          `[telegram] ошибка обработки входящего из chat ${ctx.message.chat.id}:`,
          e,
        );
      }
    });

    // ошибки уже идущего поллинга и хендлеров (сеть, 409 Conflict) — сюда
    this.bot.catch((err) => {
      console.error("[telegram] ошибка поллинга/хендлера:", err.error);
    });

    // грабля grammy: реджект самого start() (например, токен отозвали
    // после getMe) НЕ ловится bot.catch — нужен отдельный .catch, иначе
    // unhandledRejection
    void this.bot
      .start({
        onStart: () => console.log("[telegram] long-polling запущен"),
      })
      .catch((err) => {
        console.error(
          "[telegram] поллинг остановился с фатальной ошибкой:",
          err,
        );
      });
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }

  async deliver(m: OutboundMessage): Promise<void> {
    for (const part of chunkText(m.text)) {
      try {
        await sendWithRetry(() => this.bot.api.sendMessage(m.chatId, part));
      } catch (e) {
        if (!isRetryable(e)) {
          // 403 bot blocked / 400 chat not found — повторять бессмысленно
          throw new PermanentDeliveryError(
            `Telegram отверг сообщение для чата ${m.chatId}: ${
              e instanceof Error ? e.message : String(e)
            }`,
            e,
          );
        }
        throw e; // временная ошибка после исчерпания ретраев — повторит поллер
      }
    }
  }
}
