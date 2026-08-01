import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type {
  InboundMessage,
  InboundSource,
  OutboundMessage,
  OutboundSink,
} from "../types.js";

/**
 * Эмулятор Telegram для Фазы 0: POST /simulate — «клиент написал боту»,
 * GET /outbox — «что бот отправил клиенту». В Фазе 1 заменяется реальным
 * Telegram-адаптером (long-polling Bot API)
 * с теми же интерфейсами InboundSource/OutboundSink.
 */
export class StubTelegram implements InboundSource, OutboundSink {
  private server: Server | undefined;
  private outbox: OutboundMessage[] = [];
  port: number;

  constructor(port: number) {
    this.port = port;
  }

  async start(onMessage: (m: InboundMessage) => Promise<void>): Promise<void> {
    this.server = createServer((req, res) => {
      void this.route(req, res, onMessage);
    });
    await new Promise<void>((resolve) =>
      this.server?.listen(this.port, "127.0.0.1", resolve),
    );
    const addr = this.server.address();
    if (addr && typeof addr === "object") this.port = addr.port;
  }

  private async route(
    req: IncomingMessage,
    res: ServerResponse,
    onMessage: (m: InboundMessage) => Promise<void>,
  ): Promise<void> {
    try {
      if (req.method === "POST" && req.url === "/simulate") {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        let body: Partial<InboundMessage>;
        try {
          body = JSON.parse(
            Buffer.concat(chunks).toString("utf8"),
          ) as Partial<InboundMessage>;
        } catch {
          res.writeHead(400).end(JSON.stringify({ error: "невалидный JSON" }));
          return;
        }
        if (
          typeof body.chatId !== "string" ||
          typeof body.name !== "string" ||
          typeof body.text !== "string"
        ) {
          res
            .writeHead(400)
            .end(JSON.stringify({ error: "нужны chatId, name, text" }));
          return;
        }
        await onMessage({
          chatId: body.chatId,
          name: body.name,
          text: body.text,
        });
        res.writeHead(202).end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.method === "GET" && req.url === "/outbox") {
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify(this.outbox));
        return;
      }
      if (req.method === "DELETE" && req.url === "/outbox") {
        this.outbox = [];
        res.writeHead(204).end();
        return;
      }
      res.writeHead(404).end();
    } catch (e) {
      res.writeHead(500).end(JSON.stringify({ error: String(e) }));
    }
  }

  async deliver(m: OutboundMessage): Promise<void> {
    this.outbox.push(m);
    console.log(`[outbox → chat ${m.chatId}] ${m.text}`);
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.server
        ? this.server.close((e) => (e ? reject(e) : resolve()))
        : resolve(),
    );
  }
}
