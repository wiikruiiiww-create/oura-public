import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BuzzApi, BuzzMessage } from "../types.js";

const run = promisify(execFile);

export interface BuzzCliOptions {
  /** путь к бинарю buzz (или process.execPath в тестах) */
  binPath: string;
  /** префикс-аргументы (в тестах — путь к fake-buzz.mjs) */
  binArgs?: string[];
  relayUrl: string;
}

export class BuzzCliError extends Error {
  constructor(
    readonly code: number,
    readonly stderr: string,
  ) {
    super(`buzz-cli exit ${code}: ${stderr}`);
  }
}

interface RawMessage {
  id?: string;
  event_id?: string;
  pubkey?: string;
  author?: string;
  content?: string;
  created_at?: number;
}

export class BuzzCli implements BuzzApi {
  constructor(private readonly opts: BuzzCliOptions) {}

  private async exec(nsec: string, args: string[]): Promise<unknown> {
    try {
      const { stdout } = await run(this.opts.binPath, [...(this.opts.binArgs ?? []), ...args], {
        env: {
          ...process.env,
          BUZZ_RELAY_URL: this.opts.relayUrl,
          BUZZ_PRIVATE_KEY: nsec,
        },
        maxBuffer: 10 * 1024 * 1024,
      });
      const text = stdout.trim();
      return text ? JSON.parse(text) : null;
    } catch (e) {
      const err = e as { code?: number; stderr?: string; message?: string };
      if (typeof err.code === "number") throw new BuzzCliError(err.code, err.stderr ?? "");
      throw new BuzzCliError(-1, err.stderr ?? err.message ?? String(e));
    }
  }

  async createChannel(nsec: string, name: string): Promise<string> {
    const res = (await this.exec(nsec, [
      "channels", "create", "--name", name, "--type", "stream", "--visibility", "open",
    ])) as { id?: string; channel_id?: string; channel?: { id?: string } } | null;
    const id = res?.id ?? res?.channel_id ?? res?.channel?.id;
    if (!id) throw new Error(`channels create: нет id в ответе: ${JSON.stringify(res)}`);
    return id;
  }

  async addMember(nsec: string, channelId: string, pubkeyHex: string): Promise<void> {
    await this.exec(nsec, ["channels", "add-member", "--channel", channelId, "--pubkey", pubkeyHex]);
  }

  async sendMessage(nsec: string, channelId: string, content: string): Promise<void> {
    await this.exec(nsec, ["messages", "send", "--channel", channelId, "--content", content]);
  }

  async getMessages(nsec: string, channelId: string, limit = 50): Promise<BuzzMessage[]> {
    const res = await this.exec(nsec, [
      "messages", "get", "--channel", channelId, "--limit", String(limit),
    ]);
    const list: RawMessage[] = Array.isArray(res)
      ? (res as RawMessage[])
      : ((res as { messages?: RawMessage[] } | null)?.messages ?? []);
    return list.map((raw) => {
      const id = raw.id ?? raw.event_id;
      const authorPubkey = raw.pubkey ?? raw.author;
      if (!id || !authorPubkey) {
        throw new Error(`messages get: неожиданная форма сообщения: ${JSON.stringify(raw)}`);
      }
      return { id, authorPubkey, content: raw.content ?? "", createdAt: raw.created_at ?? 0 };
    });
  }

  async trySetProfile(nsec: string, name: string): Promise<void> {
    try {
      await this.exec(nsec, ["users", "set-profile", "--name", name]);
    } catch {
      // профиль — необязательная косметика; форма флагов может отличаться
    }
  }
}
