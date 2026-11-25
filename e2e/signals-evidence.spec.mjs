import { expect, test } from "@playwright/test";

// The built @didit-protocol/signals package, in a real page: its core loads the device collector
// (dist/collector.mjs) on demand, and an event carries the evidence the collector reports, never a score.
test("an event from the built package carries the collector's evidence and no bot member", async ({ page }) => {
  const posted = [];
  await page.route("**/stub/v1/events/batch/", async (route) => {
    posted.push({ headers: route.request().headers(), body: route.request().postDataJSON() });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) });
  });
  const collectorFetched = page.waitForResponse((response) => response.url().endsWith("/packages/signals/dist/collector.mjs"));

  await page.goto("/e2e/fixtures/events.html?build=signals-esm");
  await expect(page.locator("body[data-ready=true]")).toBeAttached();
  // A request waits for the collector for two seconds at most, and a cold browser on a busy machine
  // can need longer: wait until the collection is done, so this checks the full payload.
  await expect
    .poll(() => page.evaluate(async () => (await window.events.getDeviceFingerprintPayload()).signals.tier), { timeout: 30000 })
    .toBe("full");
  await page.evaluate(() => {
    window.events.configureEvents({ baseUrl: "/stub" });
    window.events.submitEvent({
      monitoringToken: "token",
      event: { category: "auth", actionType: "login", eventId: "evidence-1" }
    });
    return window.events.flush();
  });

  expect((await collectorFetched).ok()).toBe(true);
  // The count alone: a failure must not print the requests, which carry this browser's fingerprint.
  expect(posted.length).toBe(1);
  const { headers, body } = posted[0];
  expect(typeof body.fingerprint_v2.evidence).toBe("string");
  expect(body.fingerprint_v2.evidence.startsWith('{"v":2,"p":"web"')).toBe(true);
  expect(body.fingerprint_v2.signals.tier).toBe("full");
  // Booleans, never the values: a failure here must not print this browser's fingerprint or ids.
  expect("bot" in body.fingerprint_v2).toBe(false);
  expect("x-didit-fp-bot-score" in headers).toBe(false);
  // There is an id, and the header and the payload carry the same one.
  const deviceId = body.fingerprint_v2.persistentId;
  expect(typeof deviceId === "string" && deviceId.length > 0 && headers["x-didit-pid"] === deviceId).toBe(true);
});
