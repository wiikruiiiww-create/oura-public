import { mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireLock } from "../src/lock.js";

function tmpLockPath(): string {
  return join(mkdtempSync(join(tmpdir(), "oura-lock-")), "bridge.lock");
}

describe("acquireLock", () => {
  it("создаёт lock-файл со своим pid и снимает его на release", async () => {
    const path = tmpLockPath();
    const lock = await acquireLock(path);
    expect(await readFile(path, "utf8")).toBe(String(process.pid));
    await lock.release();
    await expect(readFile(path, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("отказывает, если lock держит живой процесс", async () => {
    const path = tmpLockPath();
    // pid текущего процесса заведомо жив
    await writeFile(path, String(process.pid), "utf8");
    await expect(acquireLock(path)).rejects.toThrow(String(process.pid));
  });

  it("перехватывает lock мёртвого процесса", async () => {
    const path = tmpLockPath();
    await writeFile(path, "99999999", "utf8");
    const lock = await acquireLock(path);
    expect(await readFile(path, "utf8")).toBe(String(process.pid));
    await lock.release();
  });

  it("отказывает при повреждённом lock-файле (не число)", async () => {
    const path = tmpLockPath();
    await writeFile(path, "не-pid", "utf8");
    await expect(acquireLock(path)).rejects.toThrow(path);
  });

  it("повторный release идемпотентен", async () => {
    const path = tmpLockPath();
    const lock = await acquireLock(path);
    await lock.release();
    await expect(lock.release()).resolves.toBeUndefined();
  });
});
