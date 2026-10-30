import { expect, test } from "@playwright/test";

for (let round = 0; round < 16; round += 1) {
  test(`probe scroll ${round}`, async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto("/e2e/fixtures/host.html?layout=300&textSize=200");
    const iframe = page.locator(".didit-verification-iframe");
    await expect(iframe.contentFrame().getByRole("heading", { name: "Verify your identity" })).toBeVisible();
    await expect(page.locator(".didit-modal-container.didit-flow-sized")).toHaveCount(1);
    const dialog = page.getByRole("dialog", { name: "Exit verification?", exact: true });
    await page.getByRole("button", { name: "Close verification" }).focus();
    await page.keyboard.press("Enter");
    const samples = [];
    for (let i = 0; i < 25; i += 1) {
      samples.push(
        await page.locator(".didit-confirm-overlay").evaluate((element) => ({
          top: element.scrollTop,
          active: document.activeElement?.className
        }))
      );
      await page.waitForTimeout(20);
    }
    const nonzero = samples.find((sample) => sample.top !== 0);
    console.log("SAMPLES", round, JSON.stringify(samples.slice(0, 4)), "NONZERO", JSON.stringify(nonzero ?? null));
  });
}
