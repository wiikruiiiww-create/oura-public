import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { openSettings } from "../helpers/settings";

type E2eWindow = Window & {
  __BUZZ_E2E_COMMANDS__?: string[];
  __BUZZ_E2E_SET_MESH__?: (mesh: {
    nodeState?: "off" | "running";
    nodeMode?: "serve" | "client" | null;
  }) => void;
};

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

test("Share compute has a clear empty state and starts and stops sharing", async ({
  page,
}) => {
  await page.goto("/");
  await openSettings(page, "compute");

  const card = page.getByTestId("settings-mesh-share-compute");
  const toggle = page.getByTestId("mesh-share-compute-toggle");
  const model = page.getByTestId("mesh-share-compute-model");

  await expect(card).toContainText("Сейчас доступ не предоставлен");
  await expect(card).toContainText(
    "Выберите модель из списка ниже или укажите ссылку на модель либо локальный файл",
  );
  await expect(toggle).toBeDisabled();

  await model.fill("hf://demo/SmolLM2-135M-Instruct-GGUF:Q4_K_M");
  await expect(card).toContainText(
    "OURA скачивает удалённые модели при запуске раздачи",
  );
  await expect(toggle).toBeEnabled();

  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(card).toContainText("Раздаёт SmolLM2 135M участникам релея");
  await expect
    .poll(() =>
      page.evaluate(() => (window as E2eWindow).__BUZZ_E2E_COMMANDS__ ?? []),
    )
    .toContain("mesh_start_node");

  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(card).toContainText("Сейчас доступ не предоставлен");
  await expect
    .poll(() =>
      page.evaluate(() => (window as E2eWindow).__BUZZ_E2E_COMMANDS__ ?? []),
    )
    .toContain("mesh_stop_node");
});

test("consuming a peer's compute does NOT light the Share toggle", async ({
  page,
}) => {
  // Regression: consuming someone else's shared compute starts a client-mode
  // node in the single runtime slot, which reports state:"running". The Share
  // toggle keyed off state alone and lit up — and clicking it would have torn
  // down the unrelated consume session. It must stay off + disabled, explain
  // why, and issue no stop command.
  await page.goto("/");
  // The mesh seed hook is installed when the mock bridge boots; calling it
  // before then silently no-ops (optional chaining) and the seed is lost.
  await page.waitForFunction(
    () => typeof (window as E2eWindow).__BUZZ_E2E_SET_MESH__ === "function",
  );
  await page.evaluate(() => {
    (window as E2eWindow).__BUZZ_E2E_SET_MESH__?.({
      nodeState: "running",
      nodeMode: "client",
    });
  });
  await openSettings(page, "compute");

  const card = page.getByTestId("settings-mesh-share-compute");
  const toggle = page.getByTestId("mesh-share-compute-toggle");

  await expect(card).toContainText(
    "Это устройство сейчас использует вычисления, которыми поделился",
  );
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeDisabled();

  // The switch is disabled, so a click can't fire onCheckedChange — but assert
  // the destructive command never went out regardless.
  const stopIssued = await page.evaluate(() =>
    ((window as E2eWindow).__BUZZ_E2E_COMMANDS__ ?? []).includes(
      "mesh_stop_node",
    ),
  );
  expect(stopIssued).toBe(false);
});
