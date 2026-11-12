import {
  choosePersistentId,
  isValidPersistentId,
  type PersistentIdResult,
  STORAGE_KEY,
  type StorageLayer,
  SYNC_STORAGE_LAYERS,
} from "./storage";

const LAYER_TIMEOUT_MS = 50;
const IDB_NAME = "didit-fp";
const IDB_STORE = "ids";
const CACHE_NAME = "didit-pid-v1";
const CACHE_URL = "/_didit/pid";

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      if (typeof indexedDB === "undefined") {
        reject(new Error("indexedDB unavailable"));
        return;
      }
      const request = indexedDB.open(IDB_NAME, 1);
      request.onupgradeneeded = () => {
        // request.result can be null here on some iOS Safari and WKWebView builds. This callback
        // runs outside the surrounding try/catch, so an unguarded access would be an uncaught
        // TypeError. Bail out quietly: onerror/onsuccess still settle the open, and the id simply
        // lives in the other layers.
        const db = request.result;
        if (!db?.objectStoreNames) {
          return;
        }
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("indexedDB open failed"));
      request.onblocked = () => reject(new Error("indexedDB blocked"));
    } catch (error) {
      reject(error);
    }
  });
}

const indexedDbLayer: StorageLayer = {
  source: "idb",
  async read() {
    try {
      const db = await openIdb();
      return await new Promise<string | null>((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE, "readonly");
          const req = tx.objectStore(IDB_STORE).get(STORAGE_KEY);
          req.onsuccess = () => {
            const value = req.result;
            resolve(isValidPersistentId(value) ? value : null);
          };
          req.onerror = () => resolve(null);
          tx.oncomplete = () => db.close();
        } catch {
          resolve(null);
        }
      });
    } catch {
      return null;
    }
  },
  async write(id) {
    try {
      const db = await openIdb();
      return await new Promise<boolean>((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE, "readwrite");
          tx.objectStore(IDB_STORE).put(id, STORAGE_KEY);
          tx.oncomplete = () => {
            db.close();
            resolve(true);
          };
          tx.onerror = () => {
            db.close();
            resolve(false);
          };
        } catch {
          resolve(false);
        }
      });
    } catch {
      return false;
    }
  },
};

const cacheLayer: StorageLayer = {
  source: "cache",
  async read() {
    try {
      if (typeof caches === "undefined") return null;
      const cache = await caches.open(CACHE_NAME);
      const response = await cache.match(CACHE_URL);
      if (!response) return null;
      const value = (await response.text()).trim();
      return isValidPersistentId(value) ? value : null;
    } catch {
      return null;
    }
  },
  async write(id) {
    try {
      if (typeof caches === "undefined") return false;
      const cache = await caches.open(CACHE_NAME);
      await cache.put(CACHE_URL, new Response(id, { headers: { "Content-Type": "text/plain" } }));
      return true;
    } catch {
      return false;
    }
  },
};

const [localStorageLayer, cookieLayer] = SYNC_STORAGE_LAYERS;

/**
 * Every place a browser can keep the id, so clearing one of them (cookies, "site data" in some
 * browsers) does not make a known device look new. Listed in the order a tie is settled in.
 */
const BROWSER_STORAGE_LAYERS: StorageLayer[] = [localStorageLayer, indexedDbLayer, cookieLayer, cacheLayer];

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, timeoutMs);
    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

/**
 * The stored id from every layer, each held to LAYER_TIMEOUT_MS so one blocked store cannot hold
 * the id back, then written back to the layers that missed it.
 *
 * `embedderId` is the stored id of the page that embeds this one, when it passed it. It is used
 * only when no layer has an id (a first visit, or a browser that gives a framed page no storage
 * that lasts), and is never written here.
 */
async function loadOrCreatePersistentIdFromBrowserStorage(
  layers: StorageLayer[] = BROWSER_STORAGE_LAYERS,
  embedderId?: string | null,
): Promise<PersistentIdResult> {
  const values = await Promise.all(
    layers.map((layer) => withTimeout(Promise.resolve(layer.read()), LAYER_TIMEOUT_MS, null)),
  );
  const { result, stale } = choosePersistentId(layers, values, embedderId);
  await Promise.all(
    stale.map((layer) => withTimeout(Promise.resolve(layer.write(result.id)), LAYER_TIMEOUT_MS, false)),
  );
  return result;
}

export { BROWSER_STORAGE_LAYERS, LAYER_TIMEOUT_MS, loadOrCreatePersistentIdFromBrowserStorage };
