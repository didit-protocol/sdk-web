import { expect, test } from "@playwright/test";

// One device, one id. The core of the built @didit-protocol/signals package names the device at
// once, from localStorage and a cookie; the device collector it loads settles the stores. These
// tests run the two together, in a real page, in both of the package's modes: the default, where
// those two stores are all there is, and `durableDeviceId`, where the id is also kept in IndexedDB
// and Cache storage.
//
// Every id is compared in the page and reported as a boolean: a failure must not print an id.

const DURABLE = { durableDeviceId: true };

async function open(page, device) {
  await page.goto("/e2e/fixtures/events.html?build=signals-esm");
  await expect(page.locator("body[data-ready=true]")).toBeAttached();
  if (device) await page.evaluate((options) => window.events.configureDevice(options), device);
}

async function collectorFinished(page) {
  await expect
    .poll(() => page.evaluate(async () => (await window.events.getDeviceFingerprintPayload()).signals.tier), { timeout: 30000 })
    .toBe("full");
}

/** The device's id once the collector has finished. It stays in the test, and is only ever compared. */
async function settledId(page) {
  await collectorFinished(page);
  return page.evaluate(async () => (await window.events.getDeviceFingerprintPayload()).persistentId);
}

/** What the page's payloads and its two stores say, compared with `known` where one is given. */
function identities(page, known = null) {
  return page.evaluate(async (knownId) => {
    const lite = await window.events.getDeviceFingerprintPayload({ tier: "lite" });
    const full = await window.events.getDeviceFingerprintPayload();
    return {
      fullTier: full.signals.tier,
      oneId: full.persistentId.length > 0 && lite.persistentId === full.persistentId,
      inLocalStorage: localStorage.getItem("didit-pid-v1") === full.persistentId,
      inCookie: document.cookie.includes(`didit_pid=${full.persistentId}`),
      isTheKnownId: knownId === null ? null : full.persistentId === knownId,
      liteSaysCreated: lite.persistentIdWasCreated,
      fullSaysCreated: full.persistentIdWasCreated
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

/**
 * Whether an entry this test puts in Cache storage is still there on the next page. A browser
 * session that keeps no data on disk can drop it (the test build of WebKit does, for any cache a
 * page makes): the id has then nowhere to last, and there is nothing to bring back.
 */
async function cacheStorageLasts(page) {
  await open(page);
  const made = await page.evaluate(async () => {
    if (!("caches" in window)) return false;
    await (await caches.open("e2e-probe")).put("/e2e-probe", new Response("probe"));
    return true;
  });
  if (!made) return false;
  await open(page);
  return page.evaluate(async () => {
    const lasted = Boolean(await (await caches.open("e2e-probe")).match("/e2e-probe"));
    await caches.delete("e2e-probe");
    return lasted;
  });
}

const clearPageStores = (page) =>
  page.evaluate(() => {
    localStorage.removeItem("didit-pid-v1");
    document.cookie = "didit_pid=; Path=/; Max-Age=0";
  });
const clearCacheStorage = (page) =>
  page.evaluate(async () => {
    for (const name of await caches.keys()) await caches.delete(name);
  });
const clearIndexedDb = (page) =>
  page.evaluate(async () => {
    for (const { name } of await indexedDB.databases()) {
      await new Promise((resolve) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = request.onerror = request.onblocked = () => resolve();
      });
    }
  });

test.describe("by default: the page's two stores", () => {
  test("a new device is created once: one id in both payloads and both stores, and nowhere else", async ({ page }) => {
    await open(page);

    const madeUp = await page.evaluate(async () => {
      const lite = await window.events.getDeviceFingerprintPayload({ tier: "lite" });
      window.madeUpId = lite.persistentId;
      // As it always did, the package stores the id it makes up at once.
      return lite.persistentIdWasCreated && localStorage.getItem("didit-pid-v1") === lite.persistentId;
    });
    const id = await settledId(page);
    const keptTheMadeUpId = await page.evaluate((settled) => settled === window.madeUpId, id);

    expect(madeUp).toBe(true);
    expect(keptTheMadeUpId).toBe(true);
    expect(await identities(page, id)).toEqual({
      fullTier: "full",
      oneId: true,
      inLocalStorage: true,
      inCookie: true,
      isTheKnownId: true,
      liteSaysCreated: true,
      fullSaysCreated: true
    });
    // The collector kept to the two stores: no copy in IndexedDB or in Cache storage.
    expect(await cacheHolds(page, id)).not.toBe(true);
    expect(await indexedDbHolds(page, id)).not.toBe(true);
  });

  test("an id the visitor cleared is gone: the device is new on the next page", async ({ page }) => {
    await open(page);
    const known = await settledId(page);

    await clearPageStores(page);
    await open(page);
    await collectorFinished(page);

    expect(await identities(page, known)).toEqual({
      fullTier: "full",
      oneId: true,
      inLocalStorage: true,
      inCookie: true,
      isTheKnownId: false,
      liteSaysCreated: true,
      fullSaysCreated: true
    });
  });
});

test.describe("with durableDeviceId: the id is also kept in IndexedDB and Cache storage", () => {
  const RECOVERED = {
    fullTier: "full",
    oneId: true,
    inLocalStorage: true,
    inCookie: true,
    isTheKnownId: true,
    liteSaysCreated: false,
    fullSaysCreated: false
  };

  test("a new device is created once, and stored only after the collector has read every store", async ({ page }) => {
    await open(page, DURABLE);

    const before = await page.evaluate(async () => {
      const lite = await window.events.getDeviceFingerprintPayload({ tier: "lite" });
      window.madeUpId = lite.persistentId;
      // Nothing is stored by the first read: a copy would vote against an id a slower store holds.
      return lite.persistentIdWasCreated && localStorage.getItem("didit-pid-v1") === null && !document.cookie.includes("didit_pid=");
    });
    const id = await settledId(page);
    const keptTheMadeUpId = await page.evaluate((settled) => settled === window.madeUpId, id);

    expect(before).toBe(true);
    expect(keptTheMadeUpId).toBe(true);
    await expect.poll(() => identities(page, id), { timeout: 5000 }).toEqual({
      fullTier: "full",
      oneId: true,
      inLocalStorage: true,
      inCookie: true,
      isTheKnownId: true,
      liteSaysCreated: true,
      fullSaysCreated: true
    });
  });

  test("Cache storage alone brings the id back after cookies, localStorage and IndexedDB were cleared", async ({ page }) => {
    test.skip(!(await cacheStorageLasts(page)), "this browser session keeps no Cache storage entry from one page to the next");
    await open(page, DURABLE);
    const known = await settledId(page);
    // The collector writes the slower stores after it has answered.
    await expect.poll(() => cacheHolds(page, known), { timeout: 5000 }).toBe(true);

    await clearPageStores(page);
    await clearIndexedDb(page);
    expect(await indexedDbHolds(page, known)).not.toBe(true);
    await open(page, DURABLE);
    const madeUpAnother = await page.evaluate(async (knownId) => {
      const lite = await window.events.getDeviceFingerprintPayload({ tier: "lite" });
      return lite.persistentIdWasCreated && lite.persistentId !== knownId;
    }, known);
    await collectorFinished(page);

    expect(madeUpAnother).toBe(true);
    expect(await identities(page, known)).toEqual(RECOVERED);
  });

  test("IndexedDB alone brings the id back after cookies, localStorage and Cache storage were cleared", async ({ page }) => {
    await open(page, DURABLE);
    const known = await settledId(page);
    test.skip((await indexedDbHolds(page, known)) === null, "this browser does not list the page's IndexedDB databases");
    await expect.poll(() => indexedDbHolds(page, known), { timeout: 5000 }).toBe(true);

    await clearPageStores(page);
    await clearCacheStorage(page);
    expect(await cacheHolds(page, known)).not.toBe(true);
    await open(page, DURABLE);
    await collectorFinished(page);

    expect(await identities(page, known)).toEqual(RECOVERED);
  });

  test("a page left between its first read and the collection does not cost the device its id", async ({ page }) => {
    await open(page, DURABLE);
    const known = await settledId(page);
    await expect.poll(async () => (await cacheHolds(page, known)) || (await indexedDbHolds(page, known)), { timeout: 5000 }).toBe(true);
    await clearPageStores(page);

    // A page that names the device (a first request goes out) and is left before the collector ran.
    await open(page, DURABLE);
    const leftNothingBehind = await page.evaluate(async (knownId) => {
      const lite = await window.events.getDeviceFingerprintPayload({ tier: "lite", wait: false });
      return lite.persistentIdWasCreated && lite.persistentId !== knownId && localStorage.getItem("didit-pid-v1") === null;
    }, known);

    // The next page: the collector reads the stores, and no copy of that made-up id votes in them.
    await open(page, DURABLE);
    await collectorFinished(page);

    expect(leftNothingBehind).toBe(true);
    expect(await identities(page, known)).toEqual(RECOVERED);
  });
});
