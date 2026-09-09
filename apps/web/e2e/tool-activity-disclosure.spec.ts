import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

const viewports = [
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "mobile-390x844", width: 390, height: 844 },
];
const states = [
  { name: "active", live: true },
  { name: "complete", live: false },
];

test("tool calls use nested progressive disclosure", async ({ page }, testInfo) => {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const state of states) {
      await page.goto(`/e2e/fixtures/tool-activity-disclosure.html?live=${state.live ? 1 : 0}`);
      await expect(page.getByTestId("response")).toBeVisible();
      const tools = page.getByTestId("tool-calls");
      await expect(tools).toContainText("2 tool calls");
      await expect(page.getByText("Shell", { exact: true })).toBeHidden();
      await tools.locator(":scope > summary").click();
      await expect(page.getByText("Shell", { exact: true })).toBeVisible();
      await expect(page.getByText(state.live ? "Running" : "Completed").first()).toBeVisible();
      await page.getByText("Shell", { exact: true }).click();
      await expect(page.getByText("Input", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("git status --short", { exact: false })).toBeVisible();
      if (!state.live)
        await expect(page.getByText("Output", { exact: true }).first()).toBeVisible();
      await expect(page.locator("body")).toHaveJSProperty("scrollWidth", viewport.width);
      await captureScreenshot(page, testInfo, `${state.name}-${viewport.name}`);
    }
  }
});
