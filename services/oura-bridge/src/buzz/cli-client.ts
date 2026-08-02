import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BuzzApi, BuzzMessage } from "../types.js";

const run = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 30_000;

export interface BuzzCliOptions {
  /** путь к бинарю buzz (или process.execPath в тестах) */
  binPath: string;
  /** префикс-аргументы (в тестах — путь к fake-buzz.mjs) */
  binArgs?: string[];
  relayUrl: string;
  /** таймаут выполнения одного вызова buzz-cli, мс (по умолчанию 30s) */
  timeoutMs?: number;
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

  private async exec(
    nsec: string,
    args: string[],
    stdinData?: string,
  ): Promise<unknown> {
    try {
      const pending = run(
        this.opts.binPath,
        [...(this.opts.binArgs ?? []), ...args],
        {
          env: {
            ...process.env,
            BUZZ_RELAY_URL: this.opts.relayUrl,
            BUZZ_PRIVATE_KEY: nsec,
          },
          maxBuffer: 10 * 1024 * 1024,
          // Зависший buzz-cli (relay не отвечает, TCP в чёрной дыре) не должен
          // вешать промис навечно — это блокирует и поллинг, и shutdown.
          timeout: this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          killSignal: "SIGKILL",
        },
      );
      // stdin закрывается ВСЕГДА: подкоманда, ждущая stdin (конвенция
      // `--content -`), без этого висела бы до SIGKILL по таймауту (B1).
      // EPIPE от уже умершего процесса — не наша ошибка, её отдаст await.
      pending.child.stdin?.on("error", () => {});
      if (stdinData !== undefined) pending.child.stdin?.write(stdinData);
      pending.child.stdin?.end();
      const { stdout } = await pending;
      const text = stdout.trim();
      return text ? JSON.parse(text) : null;
    } catch (e) {
      const err = e as {
        code?: number | string | null;
        killed?: boolean;
        signal?: string | null;
        stderr?: string;
        message?: string;
      };
      if (typeof err.code === "number")
        throw new BuzzCliError(err.code, err.stderr ?? "");
      if (err.killed) {
        throw new BuzzCliError(
          -1,
          err.stderr ||
            `buzz-cli убит по таймауту (signal ${err.signal ?? "unknown"})`,
        );
      }
      throw new BuzzCliError(-1, err.stderr ?? err.message ?? String(e));
    }
  }

  async createChannel(nsec: string, name: string): Promise<string> {
    const res = (await this.exec(nsec, [
      "channels",
      "create",
      "--name",
      name,
      "--type",
      "stream",
      "--visibility",
      "open",
    ])) as {
      id?: string;
      channel_id?: string;
      channel?: { id?: string };
    } | null;
    const id = res?.id ?? res?.channel_id ?? res?.channel?.id;
    if (!id)
      throw new Error(
        `channels create: нет id в ответе: ${JSON.stringify(res)}`,
      );
    return id;
  }

  async addMember(
    nsec: string,
    channelId: string,
    pubkeyHex: string,
  ): Promise<void> {
    await this.exec(nsec, [
      "channels",
      "add-member",
      "--channel",
      channelId,
      "--pubkey",
      pubkeyHex,
    ]);
  }

  async sendMessage(
    nsec: string,
    channelId: string,
    content: string,
  ): Promise<void> {
    // Текст лида/оператора никогда не попадает в argv: сообщение `-` там
    // означало бы «читать stdin» (зависание до таймаута), а `-размер` и
    // подобные отвергал бы clap. `--content -` + stdin покрывает любой текст.
    await this.exec(
      nsec,
      ["messages", "send", "--channel", channelId, "--content", "-"],
      content,
    );
  }

  async getMessages(
    nsec: string,
    channelId: string,
    limit = 50,
  ): Promise<BuzzMessage[]> {
    const res = await this.exec(nsec, [
      "messages",
      "get",
      "--channel",
      channelId,
      "--limit",
      String(limit),
    ]);
    const list: RawMessage[] = Array.isArray(res)
      ? (res as RawMessage[])
      : ((res as { messages?: RawMessage[] } | null)?.messages ?? []);
    return list.map((raw) => {
      const id = raw.id ?? raw.event_id;
      const authorPubkey = raw.pubkey ?? raw.author;
      if (!id || !authorPubkey) {
        throw new Error(
          `messages get: неожиданная форма сообщения: ${JSON.stringify(raw)}`,
        );
      }
      return {
        id,
        authorPubkey,
        content: raw.content ?? "",
        createdAt: raw.created_at ?? 0,
      };
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
