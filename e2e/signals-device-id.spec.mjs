import { expect, test } from "@playwright/test";

// One device, one id. The core of the built @didit-protocol/signals package names the device at
// once, from localStorage and a cookie; the device collector it loads reads every store the
// browser has. These tests run the two together, in a real page, on what they tell each other.

/** What a payload says about the device's id, as booleans: a failure must not print an id. */
async function identities(page, known = null) {
  return page.evaluate(async (knownId) => {
    const lite = await window.events.getDeviceFingerprintPayload({ tier: "lite" });
    const full = await window.events.getDeviceFingerprintPayload();
    const stored = localStorage.getItem("didit-pid-v1");
    window.deviceId = full.persistentId;
    return {
      fullTier: full.signals.tier,
      oneId: lite.persistentId === full.persistentId && full.persistentId.length > 0,
      storedIsThatId: stored === full.persistentId,
      isTheKnownId: knownId === null ? null : full.persistentId === knownId,
      liteSaysCreated: lite.persistentIdWasCreated,
      fullSaysCreated: full.persistentIdWasCreated
    };
  }, known);
}

async function open(page) {
  await page.goto("/e2e/fixtures/events.html?build=signals-esm");
  await expect(page.locator("body[data-ready=true]")).toBeAttached();
}

async function collectorFinished(page) {
  await expect
    .poll(() => page.evaluate(async () => (await window.events.getDeviceFingerprintPayload()).signals.tier), { timeout: 30000 })
    .toBe("full");
}

test("a new device is created once: both payloads carry one id, and both say it is new", async ({ page }) => {
  await open(page);

  const madeUp = await page.evaluate(async () => {
    const lite = await window.events.getDeviceFingerprintPayload({ tier: "lite" });
    window.madeUpId = lite.persistentId;
    return lite.persistentIdWasCreated;
  });
  await collectorFinished(page);
  const after = await identities(page);
  const keptTheMadeUpId = await page.evaluate(() => window.deviceId === window.madeUpId);

  expect(madeUp).toBe(true);
  expect(after).toEqual({
    fullTier: "full",
    oneId: true,
    storedIsThatId: true,
    isTheKnownId: null,
    liteSaysCreated: true,
    fullSaysCreated: true
  });
  expect(keptTheMadeUpId).toBe(true);
});

test("a device whose cookie and localStorage were cleared keeps its id: the slower stores still hold it", async ({ page }) => {
  await open(page);
  await collectorFinished(page);
  const first = await identities(page);
  const knownId = await page.evaluate(() => window.deviceId);
  // The collector writes the id to the browser's slower stores after it answered: wait for one.
  const slowStoreHasIt = await expect
    .poll(() => page.evaluate(async () => "caches" in window && (await caches.keys()).length > 0), { timeout: 5000 })
    .toBe(true)
    .then(
      () => true,
      () => false
    );
  test.skip(!slowStoreHasIt, "this browser gave the page no slower store to keep the id in");

  await page.evaluate(() => {
    localStorage.removeItem("didit-pid-v1");
    document.cookie = "didit_pid=; Path=/; Max-Age=0";
  });
  await page.reload();
  await expect(page.locator("body[data-ready=true]")).toBeAttached();
  // With its two stores empty the core makes up an id for the first request.
  const madeUpAnother = await page.evaluate(async (known) => {
    const lite = await window.events.getDeviceFingerprintPayload({ tier: "lite" });
    return lite.persistentIdWasCreated && lite.persistentId !== known;
  }, knownId);
  await collectorFinished(page);
  const second = await identities(page, knownId);

  expect(first.fullTier).toBe("full");
  expect(madeUpAnother).toBe(true);
  // The collector found the id the device had, and both payloads and the page's stores go by it.
  expect(second).toEqual({
    fullTier: "full",
    oneId: true,
    storedIsThatId: true,
    isTheKnownId: true,
    liteSaysCreated: false,
    fullSaysCreated: false
  });
});
