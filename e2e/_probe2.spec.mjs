import { expect, test } from "@playwright/test";

const FRAME = ".didit-verification-iframe";

async function open(page, query = "") {
  await page.goto(`/e2e/fixtures/sdk-session.html${query}`);
  await expect(page.locator(FRAME)).toBeAttached();
  await expect(page.locator(FRAME).contentFrame().getByRole("heading", { name: "Verify your identity" })).toBeVisible();
  return page.locator(FRAME);
}

async function post(iframe, message) {
  await iframe.contentFrame().locator("body").evaluate((body, payload) => window.parent.postMessage(payload, "*"), message);
}

test("probe repeat launch", async ({ page }) => {
  const iframe = await open(page);
  await post(iframe, { type: "didit:ready", data: { sessionId: "ses_1" }, timestamp: 1 });
  await post(iframe, { type: "didit:completed", data: { sessionId: "ses_1", status: "Approved" }, timestamp: 2 });
  await page.waitForTimeout(100);
  await page.evaluate(() => window.startSdk(new URL("./verification-flow.html?round=2", location.href).href));
  const second = page.locator(FRAME);
  await expect(second).toHaveAttribute("src", /round=2/);
  console.log("FRAMES", await page.locator(FRAME).count(), "OVERLAYS", await page.locator(".didit-modal-overlay").count());
  await expect(second.contentFrame().getByRole("heading", { name: "Verify your identity" })).toBeVisible();
  await post(second, { type: "didit:cancelled", data: { sessionId: "ses_2" }, timestamp: 3 });
  await page.waitForTimeout(100);
  console.log("RECORDS", JSON.stringify(await page.evaluate(() => window.records)));
});

test("probe missing embedded host", async ({ page }) => {
  await page.goto(`/e2e/fixtures/sdk-session.html?embedded=true`);
  await page.evaluate(() => {
    document.getElementById("embedded-host").id = "renamed-host";
    window.startSdk();
  });
  await page.waitForTimeout(300);
  console.log(
    "EMBEDDED",
    JSON.stringify(
      await page.evaluate(() => ({
        records: window.records,
        bootErrors: window.bootErrors,
        sdkState: window.sdk ? "set" : "missing",
        overlayActive: document.querySelector(".didit-modal-overlay")?.className,
        iframes: document.querySelectorAll("iframe").length
      }))
    )
  );
});

test("probe foreign messages", async ({ page }) => {
  const iframe = await open(page);
  await post(iframe, { type: "didit:ready", data: { sessionId: "ses_1" }, timestamp: 1 });
  // Top window claims completion.
  await page.evaluate(() => window.postMessage({ type: "didit:completed", data: { status: "Approved" } }, "*"));
  // A sibling frame on another origin claims completion and close.
  await page.evaluate(() => {
    const sibling = document.createElement("iframe");
    sibling.src = "http://localhost:4173/e2e/fixtures/host.html";
    document.body.appendChild(sibling);
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const sibling = document.querySelectorAll("iframe")[1];
    sibling.contentWindow.postMessage({ type: "didit:completed", data: { status: "Approved" } }, "*");
    sibling.contentWindow.postMessage({ type: "didit:close_request" }, "*");
  });
  await page.waitForTimeout(300);
  console.log("RECORDS", JSON.stringify(await page.evaluate(() => window.records)));
});

test("probe redirect to another origin", async ({ page }) => {
  const iframe = await open(page);
  await post(iframe, { type: "didit:ready", data: { sessionId: "ses_1" }, timestamp: 1 });
  await iframe.contentFrame().evaluate(() => {
    window.location.href = "http://localhost:4173/e2e/fixtures/verification-flow.html?redirected=1";
  });
  await page.waitForTimeout(800);
  const frames = page.frames().map((frame) => frame.url());
  console.log("FRAMES", JSON.stringify(frames));
  const redirected = page.frames().find((frame) => frame.url().includes("localhost:4173"));
  console.log("HASREDIRECT", Boolean(redirected));
  if (redirected) {
    await redirected.locator("body").evaluate(() => window.parent.postMessage({ type: "didit:completed", data: { sessionId: "ses_1", status: "Approved" }, timestamp: 2 }, "*"));
  }
  await page.waitForTimeout(300);
  console.log("RECORDS", JSON.stringify(await page.evaluate(() => window.records)));
});

test("probe interrupted: close then late message", async ({ page }) => {
  const iframe = await open(page);
  const frame = iframe.contentFrame();
  await frame.locator("body").evaluate(() => {
    window.__parent = window.parent;
  });
  await page.getByRole("button", { name: "Close verification" }).click();
  await page.getByRole("button", { name: "Exit", exact: true }).click();
  await page.waitForTimeout(100);
  // Late completion after close must not reach the integrator.
  await page.evaluate(() => window.postMessage({ type: "didit:completed", data: { status: "Approved" } }, "*"));
  await page.waitForTimeout(200);
  console.log("RECORDS", JSON.stringify(await page.evaluate(() => window.records)));
});

test("probe closeModalOnComplete", async ({ page }) => {
  const iframe = await open(page, "?closeModalOnComplete=true");
  await post(iframe, { type: "didit:completed", data: { sessionId: "ses_1", status: "Approved" }, timestamp: 1 });
  await page.waitForTimeout(200);
  console.log(
    "RECORDS",
    JSON.stringify(await page.evaluate(() => ({ r: window.records, overlay: document.querySelector(".didit-modal-overlay")?.className, src: document.querySelector("iframe")?.src })))
  );
});

test("probe invalid url", async ({ page }) => {
  await page.goto(`/e2e/fixtures/sdk-session.html`);
  await page.waitForTimeout(100);
  await page.evaluate(() => window.sdk.destroy());
  await page.evaluate(() => {
    window.records = { events: [], states: [], results: [] };
    window.sdk.onStateChange = (state, error) => window.records.states.push({ state, error: error ?? null });
    window.sdk.onComplete = (result) => window.records.results.push(result);
    window.sdk.startVerification({ url: "" });
  });
  await page.waitForTimeout(200);
  console.log("RECORDS", JSON.stringify(await page.evaluate(() => ({ r: window.records, state: window.sdk.state, errorMessage: window.sdk.errorMessage }))));
});
