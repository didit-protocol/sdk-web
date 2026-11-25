import { expect, test } from "@playwright/test";

// One device, one id, kept in the page's two stores: localStorage and a cookie. These tests run
// the built @didit-protocol/signals package in a real page, in both of its modes: the default,
// where the page sends the lite fingerprint with the collector's evidence and reads nothing else
// of the device, and `fullFingerprint`, where the collector collects the full fingerprint.
//
// Every id is compared in the page and reported as a boolean: a failure must not print an id.

const FULL = { fullFingerprint: true };

/**
 * Counts, from before the page's own scripts run, what a full fingerprint reads and where a
 * durable id would be kept: canvas contexts, offline audio contexts, IndexedDB and Cache storage.
 */
const countDeviceReads = (page) =>
  page.addInitScript(() => {
    const counts = (window.deviceReads = { canvasContexts: 0, audioContexts: 0, indexedDbOpens: 0, cacheOpens: 0 });
    const counted = (owner, name, key) => {
      const original = owner?.[name];
      if (typeof original !== "function") return;
      owner[name] = function (...args) {
        counts[key] += 1;
        return original.apply(this, args);
      };
    };
    counted(HTMLCanvasElement.prototype, "getContext", "canvasContexts");
    // The collector draws on an offscreen canvas where the browser has one.
    counted(window.OffscreenCanvas?.prototype, "getContext", "canvasContexts");
    counted(window.IDBFactory?.prototype, "open", "indexedDbOpens");
    counted(window.CacheStorage?.prototype, "open", "cacheOpens");
    const OfflineAudio = window.OfflineAudioContext;
    if (OfflineAudio) {
      window.OfflineAudioContext = new Proxy(OfflineAudio, {
        construct(target, args) {
          counts.audioContexts += 1;
          return new target(...args);
        }
      });
    }
  });

const deviceReads = (page) => page.evaluate(() => window.deviceReads);

async function open(page, device) {
  await page.goto("/e2e/fixtures/events.html?build=signals-esm");
  await expect(page.locator("body[data-ready=true]")).toBeAttached();
  if (device) await page.evaluate((options) => window.events.configureDevice(options), device);
}

/**
 * Waits until the collector is there, however long this browser needs: a request waits for it for
 * two seconds at most, and a cold browser on a busy machine can need longer.
 */
async function collectorLoaded(page) {
  await expect
    .poll(() => page.evaluate(async () => typeof (await window.events.getDeviceFingerprintPayload()).evidence), { timeout: 30000 })
    .toBe("string");
}

async function fullFingerprintCollected(page) {
  await expect
    .poll(() => page.evaluate(async () => (await window.events.getDeviceFingerprintPayload()).signals.tier), { timeout: 30000 })
    .toBe("full");
}

/** The device's id as the page hands it out. It stays in the test, and is only ever compared. */
const currentId = (page) => page.evaluate(async () => (await window.events.getDeviceFingerprintPayload()).persistentId);

/** What the page's payloads and its two stores say, compared with `known` where one is given. */
function identities(page, known = null) {
  return page.evaluate(async (knownId) => {
    const lite = await window.events.getDeviceFingerprintPayload({ tier: "lite" });
    const sent = await window.events.getDeviceFingerprintPayload();
    return {
      tier: sent.signals.tier,
      hasEvidence: typeof sent.evidence === "string" && sent.evidence.startsWith('{"v":2,"p":"web"'),
      oneId: sent.persistentId.length > 0 && lite.persistentId === sent.persistentId,
      inLocalStorage: localStorage.getItem("didit-pid-v1") === sent.persistentId,
      inCookie: document.cookie.includes(`didit_pid=${sent.persistentId}`),
      isTheKnownId: knownId === null ? null : sent.persistentId === knownId,
      liteSaysCreated: lite.persistentIdWasCreated,
      sentSaysCreated: sent.persistentIdWasCreated
    };
  }, known);
}

/** Whether an entry of this origin's Cache storage holds exactly this id. Null: there is no Cache storage. */
function cacheHolds(page, id) {
  return page.evaluate(async (known) => {
    if (!("caches" in window)) return null;
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const stored = await (await cache.match(request)).text();
        if (stored.trim() === known) return true;
      }
    }
    return false;
  }, id);
}

/** Whether a value in one of this origin's IndexedDB databases is exactly this id. Null: they cannot be listed. */
function indexedDbHolds(page, id) {
  return page.evaluate(async (known) => {
    if (!("indexedDB" in window) || !indexedDB.databases) return null;
    const settled = (request) =>
      new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    for (const { name } of await indexedDB.databases()) {
      const database = await settled(indexedDB.open(name));
      try {
        for (const store of database.objectStoreNames) {
          const values = await settled(database.transaction(store).objectStore(store).getAll());
          if (values.includes(known)) return true;
        }
      } finally {
        database.close();
      }
    }
    return false;
  }, id);
}

const clearPageStores = (page) =>
  page.evaluate(() => {
    localStorage.removeItem("didit-pid-v1");
    document.cookie = "didit_pid=; Path=/; Max-Age=0";
  });

test.describe("by default: the lite fingerprint and the collector's evidence", () => {
  test("a new device gets one id in both stores, and the evidence comes without a fingerprint read", async ({ page }) => {
    await countDeviceReads(page);
    await open(page);

    const madeUp = await page.evaluate(async () => {
      const lite = await window.events.getDeviceFingerprintPayload({ tier: "lite" });
      window.madeUpId = lite.persistentId;
      // As it always did, the package stores the id it makes up at once.
      return lite.persistentIdWasCreated && localStorage.getItem("didit-pid-v1") === lite.persistentId;
    });
    await collectorLoaded(page);
    const id = await currentId(page);
    const keptTheMadeUpId = await page.evaluate((current) => current === window.madeUpId, id);

    expect(madeUp).toBe(true);
    expect(keptTheMadeUpId).toBe(true);
    expect(await identities(page, id)).toEqual({
      tier: "lite",
      hasEvidence: true,
      oneId: true,
      inLocalStorage: true,
      inCookie: true,
      isTheKnownId: true,
      liteSaysCreated: true,
      sentSaysCreated: true
    });
    // The collector was asked for its evidence only: no canvas and no audio was read, and neither
    // IndexedDB nor Cache storage was opened.
    expect(await deviceReads(page)).toEqual({ canvasContexts: 0, audioContexts: 0, indexedDbOpens: 0, cacheOpens: 0 });
  });

  test("an id the visitor cleared is gone: the device is new on the next page", async ({ page }) => {
    await open(page);
    await collectorLoaded(page);
    const known = await currentId(page);

    await clearPageStores(page);
    await open(page);
    await collectorLoaded(page);

    expect(await identities(page, known)).toEqual({
      tier: "lite",
      hasEvidence: true,
      oneId: true,
      inLocalStorage: true,
      inCookie: true,
      isTheKnownId: false,
      liteSaysCreated: true,
      sentSaysCreated: true
    });
  });
});

test.describe("with fullFingerprint: the collector collects the full fingerprint", () => {
  test("under the id the page made up, kept in the page's two stores and nowhere else", async ({ page }) => {
    await countDeviceReads(page);
    await open(page, FULL);

    const madeUp = await page.evaluate(async () => {
      const lite = await window.events.getDeviceFingerprintPayload({ tier: "lite" });
      window.madeUpId = lite.persistentId;
      return lite.persistentIdWasCreated && localStorage.getItem("didit-pid-v1") === lite.persistentId;
    });
    await fullFingerprintCollected(page);
    const id = await currentId(page);
    const keptTheMadeUpId = await page.evaluate((current) => current === window.madeUpId, id);

    expect(madeUp).toBe(true);
    expect(keptTheMadeUpId).toBe(true);
    expect(await identities(page, id)).toEqual({
      tier: "full",
      hasEvidence: true,
      oneId: true,
      inLocalStorage: true,
      inCookie: true,
      isTheKnownId: true,
      liteSaysCreated: true,
      sentSaysCreated: true
    });
    const reads = await deviceReads(page);
    // The counter counts: the full fingerprint did read a canvas.
    expect(reads.canvasContexts).toBeGreaterThan(0);
    // The id is in the two stores only: the collector opened neither IndexedDB nor Cache storage.
    expect({ indexedDbOpens: reads.indexedDbOpens, cacheOpens: reads.cacheOpens }).toEqual({ indexedDbOpens: 0, cacheOpens: 0 });
    expect(await cacheHolds(page, id)).not.toBe(true);
    expect(await indexedDbHolds(page, id)).not.toBe(true);
  });

  test("an id the visitor cleared is gone: the device is new on the next page", async ({ page }) => {
    await open(page, FULL);
    await fullFingerprintCollected(page);
    const known = await currentId(page);

    await clearPageStores(page);
    await open(page, FULL);
    await fullFingerprintCollected(page);

    expect(await identities(page, known)).toEqual({
      tier: "full",
      hasEvidence: true,
      oneId: true,
      inLocalStorage: true,
      inCookie: true,
      isTheKnownId: false,
      liteSaysCreated: true,
      sentSaysCreated: true
    });
  });

  test("an id made up while the collector could not be loaded is the device's id on the next page, where it loads", async ({ page }) => {
    const collectorFile = "**/packages/signals/dist/collector.mjs";
    await page.route(collectorFile, (route) => route.abort());
    await open(page, FULL);
    // The request goes out with the lite payload alone, under an id the page made up and stored.
    const first = await page.evaluate(async () => {
      const sent = await window.events.getDeviceFingerprintPayload();
      window.sessionStorage.setItem("e2e-first-id", sent.persistentId);
      return {
        tier: sent.signals.tier,
        hasEvidence: "evidence" in sent,
        created: sent.persistentIdWasCreated,
        stored: localStorage.getItem("didit-pid-v1") === sent.persistentId
      };
    });
    const known = await page.evaluate(() => window.sessionStorage.getItem("e2e-first-id"));

    await page.unroute(collectorFile);
    await open(page, FULL);
    await fullFingerprintCollected(page);

    expect(first).toEqual({ tier: "lite", hasEvidence: false, created: true, stored: true });
    expect(await identities(page, known)).toEqual({
      tier: "full",
      hasEvidence: true,
      oneId: true,
      inLocalStorage: true,
      inCookie: true,
      isTheKnownId: true,
      liteSaysCreated: false,
      sentSaysCreated: false
    });
  });

  test("a page left between its first read and the collection keeps its id on the next page", async ({ page }) => {
    await open(page, FULL);
    // A page that names the device (a first request goes out) and is left before the collector ran.
    const known = await page.evaluate(async () => (await window.events.getDeviceFingerprintPayload({ tier: "lite", wait: false })).persistentId);

    await open(page, FULL);
    await fullFingerprintCollected(page);

    expect(await identities(page, known)).toEqual({
      tier: "full",
      hasEvidence: true,
      oneId: true,
      inLocalStorage: true,
      inCookie: true,
      isTheKnownId: true,
      liteSaysCreated: false,
      sentSaysCreated: false
    });
  });
});
