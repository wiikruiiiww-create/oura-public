import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeHeartbeat } from "../src/heartbeat.js";

function tmpPath(): string {
  return join(mkdtempSync(join(tmpdir(), "oura-hb-")), "heartbeat");
}

describe("writeHeartbeat", () => {
  it("пишет epoch-секунды в файл", async () => {
    const path = tmpPath();
    await writeHeartbeat(path, 1_700_000_123_456);
    expect(await readFile(path, "utf8")).toBe("1700000123");
  });

  it("перезаписывает предыдущее значение", async () => {
    const path = tmpPath();
    await writeHeartbeat(path, 1_000_000);
    await writeHeartbeat(path, 2_000_000);
    expect(await readFile(path, "utf8")).toBe("2000");
  });
});
