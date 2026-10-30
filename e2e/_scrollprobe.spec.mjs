import { expect, test } from "@playwright/test";

const CONTAINER = ".didit-modal-container";

for (let round = 0; round < 12; round += 1) {
  test(`probe scroll ${round}`, async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto("/e2e/fixtures/host.html?layout=300&textSize=200");
    const iframe = page.locator(".didit-verification-iframe");
    await expect(iframe.contentFrame().getByRole("heading", { name: "Verify your identity" })).toBeVisible();
    await expect(page.locator(`${CONTAINER}.didit-flow-sized`)).toHaveCount(1);
    const close = page.getByRole("button", { name: "Close verification" });
    const dialog = page.getByRole("dialog", { name: "Exit verification?", exact: true });
    await close.focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeFocused();
    const afterFocus = await page.locator(".didit-confirm-overlay").evaluate((element) => element.scrollTop);
    await page.waitForTimeout(120);
    const later = await page.locator(".didit-confirm-overlay").evaluate((element) => element.scrollTop);
    console.log("SCROLL", round, afterFocus, later);
  });
}
