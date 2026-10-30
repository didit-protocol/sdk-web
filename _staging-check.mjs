import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const consoleErrors = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

await page.goto("http://127.0.0.1:4311/index.html");
const started = Date.now();
await page.evaluate(() => window.start("https://verify.staging.didit.me/?vendor_data=qa-no-session", false));
const frame = page.locator(".didit-verification-iframe");
await frame.waitFor({ state: "visible" });
const frameHandle = await page.querySelector?.("iframe");

for (const wait of [1000, 3000, 8000, 15000]) {
  await page.waitForTimeout(wait === 1000 ? 1000 : wait - (wait === 3000 ? 1000 : wait === 8000 ? 3000 : 8000));
  const loader = await page.locator(".didit-loading").getAttribute("class");
  const heading = await page.locator(".didit-verification-iframe").contentFrame().locator("h1").first().textContent().catch(() => null);
  console.log(JSON.stringify({ waitedMs: wait, loader, flowHeading: heading, elapsed: Date.now() - started }));
}
console.log("records", JSON.stringify(await page.evaluate(() => window.records)));
console.log("errors", JSON.stringify(consoleErrors));
await page.screenshot({ path: "/tmp/staging-host/staging-modal.png" });
await browser.close();
