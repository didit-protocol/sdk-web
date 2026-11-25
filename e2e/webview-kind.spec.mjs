import { expect, test } from "@playwright/test";

// The built @didit-protocol/signals package names the kind of browser or web view twice: its core
// does for the lite payload, and the device collector does for the full one, on a page that asked
// for the full fingerprint. Such a page must report one kind, whichever payload a request went out with.
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const USER_AGENTS = [
  ["Safari on an iPhone", `${IPHONE} Version/17.5 Mobile/15E148 Safari/604.1`, "browser"],
  ["an iOS web view that names no app", `${IPHONE} Mobile/15E148`, "generic-wv"],
  ["an app that names itself on iOS", `${IPHONE} Mobile/15E148 Instagram 330.0.0.0`, "instagram"],
  [
    "an Android web view",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.82 Mobile Safari/537.36",
    "generic-wv"
  ],
  [
    "a desktop browser",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    "browser"
  ]
];

for (const [name, userAgent, kind] of USER_AGENTS) {
  test.describe(name, () => {
    test.use({ userAgent });

    test("reports one web view kind before and after the collector has collected", async ({ page }) => {
      await page.goto("/e2e/fixtures/events.html?build=signals-esm");
      await expect(page.locator("body[data-ready=true]")).toBeAttached();
      await page.evaluate(() => window.events.configureDevice({ fullFingerprint: true }));

      const before = await page.evaluate(async () => {
        const payload = await window.events.getDeviceFingerprintPayload({ tier: "lite" });
        window.liteHashBefore = payload.compositeHash;
        return {
          tier: payload.signals.tier,
          kind: payload.signals.webview.kind,
          header: window.events.buildFingerprintHeaders(payload)["X-Didit-FP-Webview"]
        };
      });
      await expect
        .poll(() => page.evaluate(async () => (await window.events.getDeviceFingerprintPayload()).signals.tier), { timeout: 30000 })
        .toBe("full");
      const after = await page.evaluate(async () => {
        const full = await window.events.getDeviceFingerprintPayload();
        const lite = await window.events.getDeviceFingerprintPayload({ tier: "lite" });
        return {
          tier: full.signals.tier,
          kind: full.signals.webview.kind,
          header: window.events.buildFingerprintHeaders(full)["X-Didit-FP-Webview"],
          liteKind: lite.signals.webview.kind,
          // A boolean, never the values: a failure must not print this browser's fingerprint.
          liteHashIsUnchanged: lite.compositeHash === window.liteHashBefore && lite.compositeHash.length > 0
        };
      });

      expect(before).toEqual({ tier: "lite", kind, header: kind });
      expect(after).toEqual({ tier: "full", kind, header: kind, liteKind: kind, liteHashIsUnchanged: true });
    });
  });
}
