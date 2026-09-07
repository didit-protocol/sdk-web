import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const FRAME = ".didit-verification-iframe";
const CONTAINER = ".didit-modal-container";
const OVERLAY = ".didit-modal-overlay";
const EMBEDDED = ".didit-embedded";
const HOST = "#verification-container";
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

// Content box, so a host border never counts as space the iframe may use.
async function contentHeight(locator) {
  return locator.evaluate((element) => element.clientHeight);
}

async function expectHeight(locator, expected) {
  const actual = await elementHeight(locator);

  expect(actual).toBeCloseTo(expected, 0);
}

function rectOf(locator) {
  return locator.evaluate((element) => {
    const { top, bottom, left, right } = element.getBoundingClientRect();
    return { top, bottom, left, right };
  });
}

// Scrolls the flow with wheel events, the way a person scrolls an iframe, so no
// assertion can be satisfied by programmatically scrolling a clipped ancestor.
async function wheelToEndOfFlow(page, iframe) {
  const frame = iframe.contentFrame();
  const box = await iframe.boundingBox();
  const atEnd = () =>
    frame
      .locator("body")
      .evaluate(() => Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight);

  await page.mouse.move(box.x + box.width / 2, box.y + 40);
  for (let attempt = 0; attempt < 40 && !(await atEnd()); attempt += 1) {
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(50);
  }

  expect(await atEnd()).toBe(true);
}

// A frame-local viewport assertion cannot see clipping that happens outside the
// iframe, so project the frame-local rect into top-level coordinates.
async function topLevelRect(iframe, locator) {
  const frame = await rectOf(iframe);
  const local = await rectOf(locator);

  return {
    top: frame.top + local.top,
    bottom: frame.top + local.bottom,
    left: frame.left + local.left,
    right: frame.left + local.right
  };
}

function outerScrollOffsets(page) {
  return page.evaluate(
    ([containerSelector, overlaySelector]) => ({
      window: { x: window.scrollX, y: window.scrollY },
      container: document.querySelector(containerSelector).scrollTop,
      overlay: document.querySelector(overlaySelector).scrollTop
    }),
    [CONTAINER, OVERLAY]
  );
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
  const viewport = { width: 1366, height: 625 };
  const iframe = await openFixture(page, viewport);
  const frame = iframe.contentFrame();
  const button = frame.getByRole("button", { name: "Continue verification" });
  const before = await outerScrollOffsets(page);

  expect(await frame.locator("body").evaluate((body) => body.scrollHeight > window.innerHeight)).toBe(true);
  await wheelToEndOfFlow(page, iframe);

  const container = await rectOf(page.locator(CONTAINER));
  const action = await topLevelRect(iframe, button);

  // The action must land inside what the page actually shows: the visible modal
  // container, and the top-level viewport itself.
  expect(action.top).toBeGreaterThanOrEqual(container.top - 1);
  expect(action.bottom).toBeLessThanOrEqual(container.bottom + 1);
  expect(action.top).toBeGreaterThanOrEqual(-1);
  expect(action.bottom).toBeLessThanOrEqual(viewport.height + 1);

  // Normal iframe scrolling must not have moved any outer scroll position.
  expect(await outerScrollOffsets(page)).toEqual(before);

  // Real pointer interaction, at the coordinates the person would click.
  await page.mouse.click((action.left + action.right) / 2, (action.top + action.bottom) / 2);
  await expect(frame.locator("body")).toHaveAttribute("data-continued", "true");

  await expect(page.getByRole("button", { name: "Close verification" })).toBeInViewport();
});

test("uses the embedded host height without a viewport cap", async ({ page }) => {
  const iframe = await openFixture(page, { width: 1000, height: 900 }, "?embedded=true&hostHeight=480");
  const hostContentHeight = await contentHeight(page.locator(HOST));

  await expectHeight(iframe, hostContentHeight);
  await expectHeight(page.locator(EMBEDDED), hostContentHeight);
});

test("fills an embedded host taller than the modal cap on a short viewport", async ({ page }) => {
  const iframe = await openFixture(page, { width: 1366, height: 625 }, "?embedded=true&hostHeight=900");
  const hostContentHeight = await contentHeight(page.locator(HOST));

  expect(hostContentHeight).toBeGreaterThan(700);
  await expectHeight(iframe, hostContentHeight);
  await expectHeight(page.locator(EMBEDDED), hostContentHeight);
});

test("follows an embedded host resized across the modal cap", async ({ page }) => {
  const iframe = await openFixture(page, { width: 1366, height: 625 }, "?embedded=true&hostHeight=600");
  const host = page.locator(HOST);

  await expectHeight(iframe, await contentHeight(host));

  for (const hostHeight of [900, 600, 1200]) {
    await host.evaluate((element, value) => {
      element.style.height = `${value}px`;
    }, hostHeight);
    await expectHeight(iframe, await contentHeight(host));
  }
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

async function captureScrolledProof(page, name, viewport, options = "") {
  const iframe = await openFixture(page, viewport, options);

  await wheelToEndOfFlow(page, iframe);
  await page.screenshot({ path: `${PROOF_DIR}/${name}.png`, fullPage: true });
}

test("captures visual proof", async ({ page }) => {
  await mkdir(PROOF_DIR, { recursive: true });
  await captureProof(page, "modal-light-desktop", { width: 1366, height: 625 });
  await captureProof(page, "modal-dark-desktop", { width: 1366, height: 625 }, "?theme=dark");
  await captureScrolledProof(page, "modal-light-desktop-bottom", { width: 1366, height: 625 });
  await captureScrolledProof(page, "modal-dark-desktop-bottom", { width: 1366, height: 625 }, "?theme=dark");
  await captureProof(page, "modal-light-mobile", { width: 390, height: 844 });
  await captureScrolledProof(page, "modal-light-mobile-bottom", { width: 390, height: 844 });
  await captureProof(page, "modal-light-embedded-tall", { width: 1366, height: 625 }, "?embedded=true&hostHeight=900");
});
