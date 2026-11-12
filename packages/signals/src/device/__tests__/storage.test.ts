import { beforeEach, describe, expect, it } from "@jest/globals";
import { installWebCryptoForTests } from "./_test_setup";
installWebCryptoForTests();

import {
  COOKIE_NAME,
  loadOrCreatePersistentId,
  readStoredPersistentId,
  resetPersistentIdForTesting,
  STORAGE_KEY,
  type StorageLayer,
  type StorageSource,
} from "../storage";
import { loadOrCreatePersistentIdFromBrowserStorage } from "../storage-layers";

function clearAllStorage() {
  try {
    localStorage.clear();
  } catch {
    // ignored
  }
  // Wipe every cookie defined on the page
  try {
    for (const part of document.cookie.split(";")) {
      const eq = part.indexOf("=");
      const name = (eq > -1 ? part.substring(0, eq) : part).trim();
      if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
    }
  } catch {
    // ignored
  }
}

describe("stored id in localStorage and a cookie", () => {
  beforeEach(() => {
    clearAllStorage();
    resetPersistentIdForTesting();
  });

  it("creates a fresh persistent_id when no storage layer has it", async () => {
    const result = await loadOrCreatePersistentId();
    expect(result.wasCreated).toBe(true);
    expect(result.id).toMatch(/^[A-Za-z0-9_-]{20,32}$/);
  });

  it("self-heals into every available storage layer on first run", async () => {
    const result = await loadOrCreatePersistentId();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(result.id);
    expect(document.cookie).toContain(`${COOKIE_NAME}=${result.id}`);
  });

  it("recovers the same persistent_id from localStorage on the second call", async () => {
    const first = await loadOrCreatePersistentId();
    resetPersistentIdForTesting();
    const second = await loadOrCreatePersistentId();
    expect(second.id).toBe(first.id);
    expect(second.wasCreated).toBe(false);
    expect(second.sources).toContain("localStorage");
  });

  it("rejects malformed values stored under our key", async () => {
    localStorage.setItem(STORAGE_KEY, "not!a!valid!base64url");
    document.cookie = `${COOKIE_NAME}=also%21bad; Path=/`;
    const result = await loadOrCreatePersistentId();
    expect(result.wasCreated).toBe(true);
    expect(result.id).not.toBe("not!a!valid!base64url");
  });

  it("falls back to memory when localStorage and cookie are wiped between calls", async () => {
    const first = await loadOrCreatePersistentId();
    clearAllStorage();
    // Don't reset the memory cache — that's exactly the recovery path we test.
    const second = await loadOrCreatePersistentId();
    expect(second.id).toBe(first.id);
    expect(second.wasCreated).toBe(false);
    expect(second.sources).toContain("memory");
  });

  it("two independent simulated tabs (no shared memory cache) recover the same id from localStorage", async () => {
    const first = await loadOrCreatePersistentId();
    resetPersistentIdForTesting();
    const second = await loadOrCreatePersistentId();
    expect(second.id).toBe(first.id);
  });
});

/** A storage layer that holds one value, answers after `delayMs` (never, when null) and records what is written. */
function fakeLayer(source: StorageSource, value: string | null, delayMs: number | null = 0) {
  const written: string[] = [];
  const layer: StorageLayer = {
    source,
    read: () =>
      new Promise((resolve) => {
        if (delayMs !== null) setTimeout(() => resolve(value), delayMs);
      }),
    write: async (id) => {
      written.push(id);
      return true;
    },
  };
  return { layer, written };
}

const ID_A = "AAAAAAAAAAAAAAAAAAAAAA";
const ID_B = "BBBBBBBBBBBBBBBBBBBBBB";

describe("stored id across every browser storage", () => {
  beforeEach(() => {
    clearAllStorage();
    resetPersistentIdForTesting();
  });

  it("takes the value most layers agree on and writes it back to the ones that differ", async () => {
    const local = fakeLayer("localStorage", ID_B);
    const idb = fakeLayer("idb", ID_A);
    const cookie = fakeLayer("cookie", null);
    const cache = fakeLayer("cache", ID_A);

    const result = await loadOrCreatePersistentIdFromBrowserStorage([local.layer, idb.layer, cookie.layer, cache.layer]);

    expect(result).toEqual({ id: ID_A, sources: ["idb", "cache"], wasCreated: false });
    expect(local.written).toEqual([ID_A]);
    expect(cookie.written).toEqual([ID_A]);
    expect(idb.written).toEqual([]);
    expect(cache.written).toEqual([]);
  });

  it("on a tie keeps the layer listed first", async () => {
    const local = fakeLayer("localStorage", ID_B);
    const idb = fakeLayer("idb", ID_A);

    const result = await loadOrCreatePersistentIdFromBrowserStorage([local.layer, idb.layer]);

    expect(result.id).toBe(ID_B);
    expect(idb.written).toEqual([ID_B]);
  });

  it("does not wait for a layer that never answers", async () => {
    const stuck = fakeLayer("idb", ID_B, null);
    const cookie = fakeLayer("cookie", ID_A);

    const result = await loadOrCreatePersistentIdFromBrowserStorage([stuck.layer, cookie.layer]);

    expect(result).toEqual({ id: ID_A, sources: ["cookie"], wasCreated: false });
    // The layer that did not answer is treated as missing the id, and gets it written.
    expect(stuck.written).toEqual([ID_A]);
  });

  it("creates one id and writes it to every layer when none has one", async () => {
    const layers = [fakeLayer("localStorage", null), fakeLayer("idb", null), fakeLayer("cache", null)];

    const result = await loadOrCreatePersistentIdFromBrowserStorage(layers.map((entry) => entry.layer));

    expect(result.wasCreated).toBe(true);
    expect(result.sources).toEqual(["fresh"]);
    for (const entry of layers) expect(entry.written).toEqual([result.id]);
  });

  it("reads the real localStorage and cookie layers, where a browser has no IndexedDB or Cache storage", async () => {
    const first = loadOrCreatePersistentId();
    resetPersistentIdForTesting();

    const again = await loadOrCreatePersistentIdFromBrowserStorage();

    expect(again.id).toBe(first.id);
    expect(again.sources).toEqual(expect.arrayContaining(["localStorage", "cookie"]));
  });
});

describe("asking for the stored id without creating one", () => {
  beforeEach(() => {
    clearAllStorage();
    resetPersistentIdForTesting();
  });

  it("answers null and leaves the page as it was: no storage entry, no cookie", () => {
    expect(readStoredPersistentId()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(document.cookie).not.toContain(COOKIE_NAME);
  });

  it("answers the id the page keeps, from localStorage or from the cookie alone", () => {
    const { id } = loadOrCreatePersistentId();
    expect(readStoredPersistentId()).toBe(id);

    localStorage.removeItem(STORAGE_KEY);
    expect(readStoredPersistentId()).toBe(id);
  });

  it("answers null for a stored value that is not an id", () => {
    localStorage.setItem(STORAGE_KEY, "not an id");
    expect(readStoredPersistentId()).toBeNull();
  });
});

describe("a framed page and the id of the page that embeds it", () => {
  beforeEach(() => {
    clearAllStorage();
    resetPersistentIdForTesting();
  });

  it("goes by the embedding page's id when its own storage has none, and writes it nowhere", async () => {
    const layers = [fakeLayer("localStorage", null), fakeLayer("idb", null), fakeLayer("cache", null)];

    const result = await loadOrCreatePersistentIdFromBrowserStorage(
      layers.map((entry) => entry.layer),
      ID_A,
    );

    expect(result).toEqual({ id: ID_A, sources: ["embedder"], wasCreated: false });
    for (const entry of layers) expect(entry.written).toEqual([]);
    // Not kept in memory either: without the embedding page's id the next read starts fresh.
    const alone = await loadOrCreatePersistentIdFromBrowserStorage(layers.map((entry) => entry.layer));
    expect(alone.id).not.toBe(ID_A);
    expect(alone.sources).toEqual(["fresh"]);
  });

  it("keeps the id it already stores, whatever the embedding page passes", async () => {
    const layers = [fakeLayer("localStorage", ID_B), fakeLayer("idb", ID_B), fakeLayer("cache", null)];

    const result = await loadOrCreatePersistentIdFromBrowserStorage(
      layers.map((entry) => entry.layer),
      ID_A,
    );

    expect(result.id).toBe(ID_B);
    expect(result.sources).toEqual(["localStorage", "idb"]);
    expect(layers[2].written).toEqual([ID_B]);
  });

  it.each([["a script"], ["<script>alert(1)</script>"], [""], ["short"], [`${"A".repeat(22)}\n`]])(
    "ignores %j, which is not a stored id, and creates its own",
    async (passed) => {
      const layers = [fakeLayer("localStorage", null)];

      const result = await loadOrCreatePersistentIdFromBrowserStorage(
        layers.map((entry) => entry.layer),
        passed,
      );

      expect(result.sources).toEqual(["fresh"]);
      expect(result.id).not.toBe(passed);
      expect(layers[0].written).toEqual([result.id]);
    },
  );
});

describe("the layered loader on a real page", () => {
  beforeEach(() => {
    clearAllStorage();
    resetPersistentIdForTesting();
  });

  it("still reads the real layers after the checks above", async () => {
    const first = loadOrCreatePersistentId();
    resetPersistentIdForTesting();

    const again = await loadOrCreatePersistentIdFromBrowserStorage();

    expect(again.id).toBe(first.id);
    expect(again.sources).toEqual(expect.arrayContaining(["localStorage", "cookie"]));
  });
});
