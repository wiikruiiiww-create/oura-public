/**
 * Контракты моста: источник эмитит входящие
 * сообщения внешнего канала, синк доставляет исходящие. В Фазе 1 реальный
 * Telegram-адаптер реализует эти же интерфейсы поверх Bot API.
 */
export interface InboundMessage {
  /** id чата во внешнем канале (в Telegram — chat.id) */
  chatId: string;
  /** отображаемое имя клиента */
  name: string;
  text: string;
}

export interface OutboundMessage {
  chatId: string;
  text: string;
}

export interface InboundSource {
  start(onMessage: (m: InboundMessage) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
}

export interface OutboundSink {
  deliver(m: OutboundMessage): Promise<void>;
}

/** Сообщение канала buzz в нормализованном виде. */
export interface BuzzMessage {
  id: string;
  authorPubkey: string;
  content: string;
  createdAt: number;
}

/** Действия моста в buzz. Реализация — обёртка buzz-cli (Task 2). */
export interface BuzzApi {
  createChannel(nsec: string, name: string): Promise<string>;
  addMember(nsec: string, channelId: string, pubkeyHex: string): Promise<void>;
  sendMessage(nsec: string, channelId: string, content: string): Promise<void>;
  getMessages(
    nsec: string,
    channelId: string,
    limit?: number,
  ): Promise<BuzzMessage[]>;
  trySetProfile(nsec: string, name: string): Promise<void>;
}
