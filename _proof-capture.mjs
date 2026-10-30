import { chromium } from "playwright";
const OUT = "/tmp/botinc-run-5b5f8506-7d82-4116-a02e-0ce4b19bdeab/pr-proof";
const browser = await chromium.launch();
for (const [name, viewport, query] of [
  ["after-modal-1440", { width: 1440, height: 900 }, ""],
  ["after-modal-390", { width: 390, height: 844 }, ""],
  ["after-embedded-1440", { width: 1440, height: 900 }, "?embedded=true"],
  ["after-embedded-390", { width: 390, height: 844 }, "?embedded=true"]
]) {
  const page = await browser.newPage({ viewport });
  await page.goto(`http://127.0.0.1:4173/e2e/fixtures/sdk-session.html${query}`);
  await page.locator("iframe").contentFrame().locator("h1").first().waitFor();
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(name);
  await page.close();
}
await browser.close();
