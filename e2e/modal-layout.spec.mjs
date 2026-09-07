import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const FRAME = ".didit-verification-iframe";
const CONTAINER = ".didit-modal-container";
const PROOF_DIR = ".github/pr-review-assets/web-sdk-modal";
const VIEWPORTS = [
  { name: "short desktop", viewport: { width: 1366, height: 625 }, height: 562.5 },
  { name: "tall desktop", viewport: { width: 1366, height: 900 }, height: 700 },
  { name: "desktop breakpoint", viewport: { width: 541, height: 800 }, height: 700 },
  { name: "mobile breakpoint", viewport: { width: 540, height: 800 }, height: 800 },
  { name: "mobile portrait", viewport: { width: 390, height: 844 }, height: 844 },
  { name: "mobile landscape", viewport: { width: 844, height: 390 }, height: 351 }
];

async function openFixture(page, viewport, options = "") {
  await page.setViewportSize(viewport);
  await page.goto(`/e2e/fixtures/host.html${options}`);
  const iframe = page.locator(FRAME);

  await expect(iframe).toBeVisible();
  await expect(iframe.contentFrame().getByRole("heading", { name: "Verify your identity" })).toBeVisible();

  return iframe;
}

async function elementHeight(locator) {
  return locator.evaluate((element) => element.getBoundingClientRect().height);
}

async function expectHeight(locator, expected) {
  const actual = await elementHeight(locator);

  expect(actual).toBeCloseTo(expected, 0);
}

for (const scenario of VIEWPORTS) {
  test(`fits the ${scenario.name} viewport`, async ({ page }) => {
    const iframe = await openFixture(page, scenario.viewport);
    const container = page.locator(CONTAINER);

    await expectHeight(iframe, scenario.height);
    await expectHeight(container, scenario.height);
  });
}

test("updates its height when the viewport resizes", async ({ page }) => {
  const iframe = await openFixture(page, { width: 1366, height: 900 });

  await expectHeight(iframe, 700);
  await page.setViewportSize({ width: 1366, height: 625 });
  await expectHeight(iframe, 562.5);
  await expectHeight(page.locator(CONTAINER), 562.5);
});

test("keeps the end of a long verification flow reachable", async ({ page }) => {
  const iframe = await openFixture(page, { width: 1366, height: 625 });
  const frame = iframe.contentFrame();
  const button = frame.getByRole("button", { name: "Continue verification" });

  expect(await frame.locator("body").evaluate((body) => body.scrollHeight > window.innerHeight)).toBe(true);
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeInViewport();
  await expect(page.getByRole("button", { name: "Close verification" })).toBeInViewport();
});

test("uses the embedded host height without a viewport cap", async ({ page }) => {
  const iframe = await openFixture(page, { width: 1000, height: 900 }, "?embedded=true&hostHeight=480");
  const host = page.locator("#verification-container");
  const hostContentHeight = await host.evaluate((element) => element.clientHeight);

  await expectHeight(iframe, hostContentHeight);
  await expectHeight(page.locator(".didit-embedded"), hostContentHeight);
});

for (const viewport of [{ width: 1366, height: 625 }, { width: 390, height: 844 }]) {
  test(`keeps exit controls reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await openFixture(page, viewport);
    const close = page.getByRole("button", { name: "Close verification" });

    await expect(close).toBeInViewport();
    await close.click();
    await expect(page.getByRole("heading", { name: "Exit verification?" })).toBeInViewport();
    await expect(page.getByText("Continue", { exact: true })).toBeInViewport();
  });
}

async function captureProof(page, name, viewport, options = "") {
  await openFixture(page, viewport, options);
  await page.screenshot({ path: `${PROOF_DIR}/${name}.png`, fullPage: true });
}

async function captureScrolledProof(page, name, viewport) {
  const iframe = await openFixture(page, viewport);
  const button = iframe.contentFrame().getByRole("button", { name: "Continue verification" });

  await button.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${PROOF_DIR}/${name}.png`, fullPage: true });
}

test("captures visual proof", async ({ page }) => {
  await mkdir(PROOF_DIR, { recursive: true });
  await captureProof(page, "modal-light-desktop", { width: 1366, height: 625 });
  await captureProof(page, "modal-dark-desktop", { width: 1366, height: 625 }, "?theme=dark");
  await captureProof(page, "modal-light-mobile", { width: 390, height: 844 });
  await captureScrolledProof(page, "modal-light-mobile-bottom", { width: 390, height: 844 });
});
