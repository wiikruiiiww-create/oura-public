import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const OUTDIR = "test-results/external-agent";

type Page = import("@playwright/test").Page;

/** Мок-мост ставится через addInitScript — до него `invoke` ещё не существует. */
async function waitForInvokeBridge(page: Page) {
  await page.waitForFunction(
    () => {
      const tauriWindow = window as Window & {
        __BUZZ_E2E_INVOKE_MOCK_COMMAND__?: unknown;
        __TAURI_INTERNALS__?: { invoke?: unknown };
      };
      return (
        typeof tauriWindow.__BUZZ_E2E_INVOKE_MOCK_COMMAND__ === "function" ||
        typeof tauriWindow.__TAURI_INTERNALS__?.invoke === "function"
      );
    },
    null,
    { timeout: 15_000 },
  );
}

async function openCreateAgentDialog(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForInvokeBridge(page);
  await expect(page.getByTestId("open-agents-view")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByTestId("open-agents-view").click();
  await page.getByTestId("agents-library-personas").waitFor();
  await page.getByTestId("new-agent-card").click();
  await page.getByRole("menuitem", { name: /Create from scratch/i }).click();
  await waitForAnimations(page);
}

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

test("capture: agent kind selector in the create dialog", async ({ page }) => {
  await openCreateAgentDialog(page);
  const selector = page.getByTestId("agent-kind-internal");
  await selector.waitFor();
  // селектор ниже фолда диалога — без прокрутки в кадр попадают только поля выше
  await selector.scrollIntoViewIfNeeded();
  await waitForAnimations(page);
  await page.screenshot({ path: `${OUTDIR}/01-agent-kind-selector.png` });
});

test("capture: external agent form", async ({ page }) => {
  await openCreateAgentDialog(page);
  await page.getByTestId("agent-kind-external").click();
  await page.getByTestId("external-agent-token").waitFor();
  await waitForAnimations(page);
  await page.screenshot({ path: `${OUTDIR}/02-external-agent-form.png` });
});

test("capture: verified bot token", async ({ page }) => {
  await openCreateAgentDialog(page);
  await page.getByTestId("agent-kind-external").click();
  await page
    .getByTestId("external-agent-token")
    .fill("123456789:AAF-abcdefghijklmnopqrstuvwxyz01");
  await page.getByRole("button", { name: "Проверить" }).click();
  await expect(page.getByText(/oura_sales_bot/)).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({ path: `${OUTDIR}/03-token-verified.png` });
});
