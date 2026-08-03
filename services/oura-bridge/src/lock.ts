import { readFile, unlink, writeFile } from "node:fs/promises";

export interface LockHandle {
  release(): Promise<void>;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: процесс существует, но принадлежит другому пользователю
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Гард от второго инстанса моста над одним state-файлом (B6): два процесса
 * писали бы bridge.state.json наперегонки, теряя ключи лидов. Lock-файл
 * содержит pid держателя; лок мёртвого процесса перехватывается, повреждённый
 * лок требует ручного вмешательства (fail-safe в пользу сохранности ключей).
 */
export async function acquireLock(path: string): Promise<LockHandle> {
  try {
    await writeFile(path, String(process.pid), {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const raw = (await readFile(path, "utf8")).trim();
    const pid = Number.parseInt(raw, 10);
    if (!Number.isInteger(pid) || pid <= 0 || String(pid) !== raw) {
      throw new Error(
        `lock-файл ${path} повреждён (содержимое: ${JSON.stringify(raw)}); ` +
          "удалите его вручную, если мост точно не запущен",
      );
    }
    if (isProcessAlive(pid)) {
      throw new Error(
        `мост уже запущен (pid ${pid}, lock-файл ${path}); второй инстанс ` +
          "с тем же state-файлом привёл бы к гонке записи и потере ключей лидов",
      );
    }
    await writeFile(path, String(process.pid), "utf8");
  }
  let released = false;
  return {
    async release(): Promise<void> {
      if (released) return;
      released = true;
      try {
        await unlink(path);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    },
  };
}
