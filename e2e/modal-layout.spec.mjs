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

// Once the flow posts didit:layout, the modal grows to the handoff card on a
// computer (960 x 660, at most 90% of the window), follows the content height
// in a narrow window and stays full screen on a phone.
const FLOW_LAYOUTS = [
  { name: "computer", viewport: { width: 1440, height: 900 }, layout: 600, width: 960, height: 660 },
  { name: "short computer window", viewport: { width: 1440, height: 580 }, layout: 600, width: 960, height: 522 },
  { name: "computer window at the breakpoint", viewport: { width: 1024, height: 768 }, layout: 600, width: 921.6, height: 660 },
  { name: "window just under the breakpoint", viewport: { width: 1023, height: 900 }, layout: 560, width: 500, height: 560 },
  { name: "narrow window", viewport: { width: 800, height: 900 }, layout: 600, width: 500, height: 600 },
  { name: "narrow window with tall content", viewport: { width: 800, height: 700 }, layout: 1200, width: 500, height: 630 },
  { name: "phone", viewport: { width: 390, height: 844 }, layout: 600, width: 390, height: 844 }
];

async function elementSize(locator) {
  return locator.evaluate((element) => {
    const { width, height } = element.getBoundingClientRect();
    return { width, height };
  });
}

// postMessage is asynchronous, so sizes are polled until the layout lands.
async function expectSize(locator, width, height) {
  await expect
    .poll(() => elementSize(locator))
    .toEqual({ width: expect.closeTo(width, 0), height: expect.closeTo(height, 0) });
}

// Opens the fixture with a flow that reports its layout on load, and waits for the modal to take it.
async function openFlowFixture(page, viewport, options) {
  const iframe = await openFixture(page, viewport, options);

  await expect(page.locator(`${CONTAINER}.didit-flow-sized`)).toHaveCount(1);
  return iframe;
}

function stepChangedCount(page) {
  return page.evaluate(() => window.diditEvents.filter((type) => type === "didit:step_changed").length);
}

// Posts a layout followed by an ordinary flow event; once the event reaches onEvent, the
// modal has handled the layout too, so an unchanged size is a real result rather than a race.
async function postLayout(page, iframe, data) {
  const before = await stepChangedCount(page);

  await iframe.contentFrame().locator("body").evaluate((body, value) => {
    window.postLayout(value);
    window.parent.postMessage({ type: "didit:step_changed", data: { step: "face" }, timestamp: Date.now() }, "*");
  }, data);
  await expect.poll(() => stepChangedCount(page)).toBe(before + 1);
}

for (const scenario of FLOW_LAYOUTS) {
  test(`sizes the flow's layout in a ${scenario.name}`, async ({ page }) => {
    const iframe = await openFlowFixture(page, scenario.viewport, `?layout=${scenario.layout}`);

    await expectSize(page.locator(CONTAINER), scenario.width, scenario.height);
    await expectHeight(iframe, scenario.height);
  });
}

test("tells the flow it is in a modal with a close button", async ({ page }) => {
  const iframe = await openFixture(page, { width: 1440, height: 900 });
  const search = await iframe.contentFrame().locator("body").evaluate(() => window.location.search);
  const params = new URLSearchParams(search);

  expect(params.get("sdk_presentation")).toBe("modal");
  expect(params.get("sdk_close_button")).toBe("true");
});

test("follows the flow's content height in a narrow window, capped at 90%", async ({ page }) => {
  const iframe = await openFlowFixture(page, { width: 800, height: 900 }, "?layout=600");
  const container = page.locator(CONTAINER);

  await expectSize(container, 500, 600);
  await postLayout(page, iframe, { contentHeight: 560 });
  await expectSize(container, 500, 560);
  await postLayout(page, iframe, { contentHeight: 2000 });
  await expectSize(container, 500, 810);
  expect(await page.evaluate(() => window.diditEvents)).not.toContain("didit:layout");
});

test("keeps the handoff card size whatever content height the flow reports", async ({ page }) => {
  const iframe = await openFlowFixture(page, { width: 1440, height: 900 }, "?layout=300");
  const container = page.locator(CONTAINER);

  await expectSize(container, 960, 660);
  await postLayout(page, iframe, { contentHeight: 900 });
  await expectSize(container, 960, 660);
});

test("switches between the card, the content height and full screen as the window resizes", async ({ page }) => {
  await openFlowFixture(page, { width: 1440, height: 900 }, "?layout=600");
  const container = page.locator(CONTAINER);

  await expectSize(container, 960, 660);
  await page.setViewportSize({ width: 800, height: 900 });
  await expectSize(container, 500, 600);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectSize(container, 390, 844);
  await page.setViewportSize({ width: 1440, height: 580 });
  await expectSize(container, 960, 522);
});

test("keeps the fixed modal when the layout has no content height", async ({ page }) => {
  const iframe = await openFixture(page, { width: 1440, height: 900 });

  await postLayout(page, iframe, { colorScheme: "dark" });
  await expect(page.locator(`${CONTAINER}.didit-flow-sized`)).toHaveCount(0);
  await expectSize(page.locator(CONTAINER), 500, 700);
});

test("keeps filling the embedded host whatever layout the flow reports", async ({ page }) => {
  const iframe = await openFixture(page, { width: 1440, height: 900 }, "?embedded=true&hostHeight=480");
  const hostContentHeight = await contentHeight(page.locator(HOST));

  await postLayout(page, iframe, { contentHeight: 900 });
  await expectHeight(iframe, hostContentHeight);
  expect(await page.evaluate(() => window.diditEvents)).not.toContain("didit:layout");
});

async function closeButtonBox(page) {
  return page.getByRole("button", { name: "Close verification" }).evaluate((button) => {
    const box = button.getBoundingClientRect();
    const frame = button.parentElement.getBoundingClientRect();
    const style = getComputedStyle(button);
    return {
      width: box.width,
      height: box.height,
      top: box.top - frame.top,
      left: box.left - frame.left,
      right: frame.right - box.right,
      background: style.backgroundColor,
      color: style.color,
      radius: style.borderRadius
    };
  });
}

test("draws the 44 px close button in the flow's top bar, light", async ({ page }) => {
  await openFlowFixture(page, { width: 1440, height: 900 }, "?layout=600");
  const box = await closeButtonBox(page);

  expect(box).toMatchObject({ width: 44, height: 44, top: 8, right: 8, radius: "50%" });
  expect(box.background).toBe("rgba(0, 0, 0, 0.06)");
  expect(box.color).toBe("rgb(26, 26, 26)");
  await expect(page.locator(`${CONTAINER} .didit-close-icon`)).toBeVisible();
  await expect(page.locator(`${CONTAINER} .didit-close-icon-legacy`)).toBeHidden();
});

test("draws the close button with the dark tokens when the flow is dark", async ({ page }) => {
  await openFlowFixture(page, { width: 1440, height: 900 }, "?layout=600&theme=dark");
  const box = await closeButtonBox(page);

  expect(box.background).toBe("rgba(255, 255, 255, 0.06)");
  expect(box.color).toBe("rgb(245, 245, 247)");
});

test("moves the close button to the left for a right-to-left flow", async ({ page }) => {
  await openFlowFixture(page, { width: 1440, height: 900 }, "?layout=600&dir=rtl");
  const box = await closeButtonBox(page);

  expect(box).toMatchObject({ width: 44, height: 44, top: 8, left: 8 });
});

test("shows the keyboard focus on the close button", async ({ page, browserName }) => {
  // WebKit leaves buttons out of the Tab order unless the platform setting is on.
  test.skip(browserName === "webkit", "WebKit skips buttons when tabbing by default");
  await openFlowFixture(page, { width: 1440, height: 900 }, "?layout=600");
  const close = page.getByRole("button", { name: "Close verification" });

  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  expect(await close.evaluate((button) => getComputedStyle(button).outline)).toMatch(/rgb\(37, 103, 255\) solid 2px|2px solid rgb\(37, 103, 255\)/);
});

for (const viewport of [{ width: 1440, height: 580 }, { width: 800, height: 900 }, { width: 390, height: 844 }]) {
  test(`keeps the exit confirmation reachable from the flow layout at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await openFlowFixture(page, viewport, "?layout=600");
    const close = page.getByRole("button", { name: "Close verification" });

    await expect(close).toBeInViewport();
    await close.click();
    await expect(page.getByRole("heading", { name: "Exit verification?" })).toBeInViewport();
    // At the default text size the dialog keeps today's 300 px width.
    expect(await page.locator(".didit-confirm-box").evaluate((box) => box.getBoundingClientRect().width)).toBeCloseTo(300, 0);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Exit verification?" })).toBeHidden();
  });
}

for (const scenario of [
  { name: "desktop light", viewport: { width: 1440, height: 900 }, options: "?layout=600" },
  { name: "short desktop dark", viewport: { width: 1440, height: 580 }, options: "?layout=600&theme=dark" },
  { name: "narrow at 200% text", viewport: { width: 800, height: 900 }, options: "?layout=300&textSize=200" },
  { name: "phone dark RTL at 200% text", viewport: { width: 390, height: 844 }, options: "?layout=600&theme=dark&dir=rtl&textSize=200" }
]) {
  test(`contains confirmation keyboard focus, ${scenario.name}`, async ({ page }) => {
    const iframe = await openFlowFixture(page, scenario.viewport, scenario.options);
    const close = page.getByRole("button", { name: "Close verification" });
    const dialog = page.getByRole("dialog", { name: "Exit verification?", exact: true });
    const continueButton = dialog.getByRole("button", { name: "Continue", exact: true });
    const exit = dialog.getByRole("button", { name: "Exit", exact: true });
    const flowAction = iframe.contentFrame().getByRole("button", { name: "Continue verification" });
    const flowBody = iframe.contentFrame().locator("body");

    await close.focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeFocused();
    expect(await page.locator(".didit-confirm-overlay").evaluate((element) => element.scrollTop)).toBe(0);

    // Every forward and backward wrap stays in the dialog, including WebKit's
    // default keyboard settings. The covered frame's real action stays untouched.
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await page.keyboard.press("Tab");
      await expect(continueButton).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(exit).toBeFocused();
      await expect(exit).toBeInViewport();
    }
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await page.keyboard.press("Shift+Tab");
      await expect(continueButton).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(exit).toBeFocused();
    }
    expect(await exit.evaluate((button) => getComputedStyle(button).outlineStyle)).toBe("solid");
    await expect(flowBody).not.toHaveAttribute("data-continued", "true");

    // Even a focus attempt from the covered frame cannot divert Enter to it.
    await flowAction.evaluate((button) => button.focus());
    await expect(dialog).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(continueButton).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(close).toBeFocused();
    await expect(flowBody).not.toHaveAttribute("data-continued", "true");

    await page.keyboard.press("Enter");
    await expect(dialog).toBeFocused();
    expect(await page.locator(".didit-confirm-overlay").evaluate((element) => element.scrollTop)).toBe(0);
    await page.keyboard.press("Shift+Tab");
    await expect(exit).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(close).toBeFocused();
    // Dismissing the confirmation restores normal flow interaction.
    await flowAction.focus();
    await page.keyboard.press("Enter");
    await expect(flowBody).toHaveAttribute("data-continued", "true");
  });
}

for (const key of ["Enter", "Space"]) {
  test(`confirms exit with ${key} from the keyboard`, async ({ page }) => {
    await openFlowFixture(page, { width: 1440, height: 900 }, "?layout=600");
    const close = page.getByRole("button", { name: "Close verification" });
    await close.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "Exit", exact: true })).toBeFocused();
    await page.keyboard.press(key);
    await expect(page.locator(OVERLAY)).toBeHidden();
    await expect(page.locator(FRAME)).toHaveAttribute("src", "about:blank");
  });
}

test("returns focus to a cross-origin flow after its close request", async ({ page }) => {
  await page.route("http://localhost:4173/**", async (route) => {
    const response = await route.fetch({ url: route.request().url().replace("localhost", "127.0.0.1") });
    await route.fulfill({ response });
  });
  await page.route("**/e2e/fixtures/host.html*", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace('"./verification-flow.html"', '"http://localhost:4173/e2e/fixtures/verification-flow.html"');
    await route.fulfill({ response, body });
  });
  const iframe = await openFlowFixture(page, { width: 1440, height: 900 }, "?layout=600");
  const flowAction = iframe.contentFrame().getByRole("button", { name: "Continue verification" });
  await flowAction.focus();
  await flowAction.evaluate(() => window.parent.postMessage({ type: "didit:close_request", timestamp: Date.now() }, "*"));
  const dialog = page.getByRole("dialog", { name: "Exit verification?", exact: true });
  await expect(dialog).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(dialog).toBeHidden();
  await expect(iframe).toBeFocused();
  // The SDK can restore the cross-origin frame, then normal tabbing resumes inside it.
  await page.keyboard.press("Tab");
  await expect(flowAction).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(iframe.contentFrame().locator("body")).toHaveAttribute("data-continued", "true");
});

// Scrolls the exit confirmation to its end with wheel events over the modal.
async function wheelToEndOfConfirmation(page, frame) {
  const overlay = page.locator(".didit-confirm-overlay");
  const atEnd = () => overlay.evaluate((element) => Math.ceil(element.scrollTop + element.clientHeight) >= element.scrollHeight);

  await page.mouse.move((frame.left + frame.right) / 2, frame.top + 40);
  for (let attempt = 0; attempt < 40 && !(await atEnd()); attempt += 1) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(50);
  }
  expect(await atEnd()).toBe(true);
}

// A short flow reports a small content height, but the exit confirmation is the SDK's own
// rem-sized dialog, so at a large text size it is taller than the modal. It must scroll
// inside the modal, by wheel and pointer only, with nothing clipped above or below.
for (const theme of ["light", "dark"]) {
  test(`scrolls an exit confirmation taller than a short flow at 200% text, ${theme}`, async ({ page }) => {
    await openFlowFixture(page, { width: 800, height: 900 }, `?layout=300&textSize=200&theme=${theme}`);
    const container = page.locator(CONTAINER);
    const heading = page.getByRole("heading", { name: "Exit verification?" });
    const exit = page.getByText("Exit", { exact: true });

    await expectSize(container, 500, 300);
    await page.getByRole("button", { name: "Close verification" }).click();
    await expect(heading).toBeVisible();

    const frame = await rectOf(container);
    const box = await rectOf(page.locator(".didit-confirm-box"));
    expect(box.bottom - box.top).toBeGreaterThan(frame.bottom - frame.top);
    expect((await rectOf(heading)).top).toBeGreaterThanOrEqual(frame.top);

    await wheelToEndOfConfirmation(page, frame);

    const action = await rectOf(exit);
    expect(action.top).toBeGreaterThanOrEqual(frame.top - 1);
    expect(action.bottom).toBeLessThanOrEqual(frame.bottom + 1);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    await page.mouse.click((action.left + action.right) / 2, (action.top + action.bottom) / 2);
    await expect(page.locator(OVERLAY)).toBeHidden();
  });

  test(`opens a scrolled exit confirmation again at its title at 200% text, ${theme}`, async ({ page }) => {
    await openFlowFixture(page, { width: 800, height: 900 }, `?layout=300&textSize=200&theme=${theme}`);
    const heading = page.getByRole("heading", { name: "Exit verification?" });
    const close = page.getByRole("button", { name: "Close verification" });

    await close.click();
    await expect(heading).toBeVisible();
    const frame = await rectOf(page.locator(CONTAINER));
    await wheelToEndOfConfirmation(page, frame);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(heading).toBeHidden();

    await close.click();
    await expect(heading).toBeVisible();
    expect(await page.locator(".didit-confirm-overlay").evaluate((element) => element.scrollTop)).toBe(0);
    expect((await rectOf(heading)).top).toBeGreaterThanOrEqual(frame.top);
  });
}

// Long translations at 200% text on a phone wrap inside the modal instead of widening the
// dialog past the screen and scrolling it sideways.
for (const { locale, theme } of [
  { locale: "de-DE", theme: "light" },
  { locale: "bg-BG", theme: "dark" }
]) {
  test.describe(`${locale} exit confirmation`, () => {
    test.use({ locale });

    test(`fits a 390 px phone at 200% text, ${theme}`, async ({ page }) => {
      const viewport = { width: 390, height: 844 };
      await openFlowFixture(page, viewport, `?layout=600&textSize=200&theme=${theme}`);

      await page.locator(".didit-close-button").click();
      const confirmBox = page.locator(".didit-confirm-box");
      await expect(confirmBox.locator("h3")).toBeVisible();

      const box = await rectOf(confirmBox);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(viewport.width);
      // Nothing inside the dialog overflows it, and nothing scrolls sideways.
      for (const selector of [".didit-confirm-box", ".didit-confirm-overlay"]) {
        const { scrollWidth, clientWidth } = await page
          .locator(selector)
          .evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    });
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
