import { writeFile } from "node:fs/promises";

/**
 * Heartbeat для контейнерного healthcheck (B4): файл с epoch-секундами
 * последнего успешного цикла поллинга. Healthcheck сравнивает значение
 * с текущим временем — зависший мост перестаёт обновлять файл.
 */
export async function writeHeartbeat(
  path: string,
  nowMs: number,
): Promise<void> {
  await writeFile(path, String(Math.floor(nowMs / 1000)), "utf8");
}
