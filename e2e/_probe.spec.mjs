import { expect, test } from "@playwright/test";

const FRAME = ".didit-verification-iframe";

async function open(page) {
  page.on("console", (message) => console.log("PAGE:", message.text()));
  page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));
  await page.goto("/e2e/fixtures/sdk-session.html");
  const iframe = page.locator(FRAME);
  await expect(iframe).toBeVisible();
  await expect(iframe.contentFrame().getByRole("heading", { name: "Verify your identity" })).toBeVisible();
  return iframe;
}

async function post(iframe, message) {
  await iframe.contentFrame().locator("body").evaluate((body, payload) => {
    window.parent.postMessage(payload, "*");
  }, message);
}

test("probe completed", async ({ page }) => {
  const iframe = await open(page);
  await post(iframe, { type: "didit:ready", data: { sessionId: "ses_1" }, timestamp: 1 });
  await post(iframe, { type: "didit:completed", data: { sessionId: "ses_1", status: "Approved" }, timestamp: 2 });
  await page.waitForTimeout(200);
  console.log("RECORDS", JSON.stringify(await page.evaluate(() => window.records)));
  console.log("STATE", await page.evaluate(() => window.sdk?.state ?? "no-sdk"));
});

test("probe error", async ({ page }) => {
  const iframe = await open(page);
  await post(iframe, { type: "didit:ready", data: { sessionId: "ses_1" }, timestamp: 1 });
  await post(iframe, { type: "didit:error", data: { error: "boom", sessionId: "ses_1" }, timestamp: 2 });
  await page.waitForTimeout(200);
  console.log("RECORDS", JSON.stringify(await page.evaluate(() => window.records)));
});

test("probe close", async ({ page }) => {
  const iframe = await open(page);
  await post(iframe, { type: "didit:ready", data: { sessionId: "ses_1" }, timestamp: 1 });
  await page.getByRole("button", { name: "Close verification" }).click();
  await page.getByRole("button", { name: "Exit", exact: true }).click();
  await page.waitForTimeout(200);
  console.log("RECORDS", JSON.stringify(await page.evaluate(() => window.records)));
});
