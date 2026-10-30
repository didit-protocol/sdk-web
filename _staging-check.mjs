import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const consoleErrors = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

await page.goto("http://127.0.0.1:4311/index.html");
const started = Date.now();
await page.evaluate(() => window.start("https://verify.staging.didit.me/", false));
const frame = page.locator(".didit-verification-iframe");
await frame.waitFor({ state: "visible" });
const loaded = Date.now();
// Wait for the frame to commit a document; its content is the hosted staging flow.
const url = await frame.getAttribute("src");
const box = await frame.boundingBox();
console.log(JSON.stringify({
  iframeSrc: url,
  launchToVisibleMs: loaded - started,
  iframeBox: box,
  overlayActive: (await page.locator(".didit-modal-overlay").getAttribute("class")).includes("active"),
  records: await page.evaluate(() => window.records),
  consoleErrors
}, null, 2));
await page.waitForTimeout(4000);
console.log("AFTER 4s", JSON.stringify(await page.evaluate(() => ({ records: window.records, frameUrl: document.querySelector("iframe").src })), null, 2));
await page.screenshot({ path: "/tmp/staging-host/staging-modal.png" });
await browser.close();
