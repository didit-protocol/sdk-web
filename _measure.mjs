import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
async function measure(url, label, embedded = false) {
  await page.goto("http://127.0.0.1:4311/index.html");
  const ms = await page.evaluate(async ({ url, embedded }) => {
    const start = performance.now();
    window.start(url, embedded);
    const heading = () => {
      const frame = document.querySelector("iframe");
      try {
        return frame?.contentDocument?.querySelector("h1")?.textContent ?? null;
      } catch {
        return null;
      }
    };
    // Same-origin measurement only; poll until the frame document has an h1.
    while (!heading() && performance.now() - start < 20000) await new Promise((r) => setTimeout(r, 10));
    return Math.round(performance.now() - start);
  }, { url, embedded });
  console.log(label, ms, "ms");
}
for (const run of [1, 2, 3]) {
  await measure("https://verify.staging.didit.me/?vendor_data=qa-perf-" + run, `staging iframe usable, run ${run}`);
}
await measure("http://127.0.0.1:4173/e2e/fixtures/verification-flow.html", "local fixture usable, run 1");
await measure("http://127.0.0.1:4173/e2e/fixtures/verification-flow.html", "local fixture usable, run 2");
await measure("http://127.0.0.1:4173/e2e/fixtures/verification-flow.html", "local fixture embedded, run 1", true);
await browser.close();
