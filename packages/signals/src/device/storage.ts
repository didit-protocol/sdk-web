import { randomBase64Url } from "./hash";

const STORAGE_KEY = "didit-pid-v1";
const COOKIE_NAME = "didit_pid";
/** The cookie's value among the page's cookies: the first one of that name. */
const COOKIE_VALUE = /(?:^|;\s*)didit_pid=([^;]*)/;
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 2;
const PERSISTENT_ID_BYTE_LENGTH = 16;

type StorageSource = "localStorage" | "cookie" | "memory" | "embedder" | "fresh";

/** One place the stored id lives in. It answers at once and never throws. */
interface StorageLayer {
  source: StorageSource;
  read: () => string | null;
  write: (id: string) => boolean;
}

interface PersistentIdResult {
  id: string;
  sources: StorageSource[];
  wasCreated: boolean;
}

let memoryFallback: string | null = null;

function isValidPersistentId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{20,32}$/.test(value);
}

// Where there is no `localStorage` or no `document` (a worker, a blocked store), reading the name
// throws like any refused access does, and the layer answers that it holds nothing.
const localStorageLayer: StorageLayer = {
  source: "localStorage",
  read() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return isValidPersistentId(value) ? value : null;
    } catch {
      // Storage may be blocked (private mode, storage policies): the other layers still apply.
      return null;
    }
  },
  write(id) {
    try {
      localStorage.setItem(STORAGE_KEY, id);
      return true;
    } catch {
      return false;
    }
  },
};

const cookieLayer: StorageLayer = {
  source: "cookie",
  read() {
    try {
      const found = document.cookie.match(COOKIE_VALUE);
      const value = found && decodeURIComponent(found[1]);
      return isValidPersistentId(value) ? value : null;
    } catch {
      return null;
    }
  },
  write(id) {
    try {
      const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${COOKIE_NAME}=${encodeURIComponent(id)}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
      return true;
    } catch {
      return false;
    }
  },
};

/**
 * The layers this entry keeps the id in. The full collector keeps it in more of them, under the
 * same localStorage key and cookie name, so both agree on the id.
 */
const STORAGE_LAYERS: StorageLayer[] = [localStorageLayer, cookieLayer];

/**
 * The stored id from the layers that answer at once (localStorage and a cookie), written back to
 * the one that missed it. Where the two hold different ids, localStorage is the one kept: it is
 * listed first, which is how the collector settles a tie between two stores too.
 *
 * With no stored id, the device goes by the id of the page that embeds this one (`embedderId`),
 * when it passed it: that id is not written to any layer and not kept in memory, because the
 * embedding page is where it lives and a value another page supplies never becomes this origin's
 * stored id. Otherwise it goes by the id kept in memory when storage is blocked, or a new one.
 */
function loadOrCreatePersistentId(embedderId?: string | null): PersistentIdResult {
  const values = STORAGE_LAYERS.map((layer) => layer.read());
  const stored = values[0] ?? values[1];
  if (!stored && isValidPersistentId(embedderId)) {
    return { id: embedderId, sources: ["embedder"], wasCreated: false };
  }

  const id = stored ?? memoryFallback ?? randomBase64Url(PERSISTENT_ID_BYTE_LENGTH);
  const result: PersistentIdResult = {
    id,
    sources: stored
      ? STORAGE_LAYERS.filter((_, index) => values[index] === id).map((layer) => layer.source)
      : [memoryFallback ? "memory" : "fresh"],
    wasCreated: !stored && !memoryFallback,
  };
  memoryFallback = id;
  STORAGE_LAYERS.forEach((layer, index) => {
    if (values[index] !== id) layer.write(id);
  });
  return result;
}

/**
 * The id this page already keeps, or null. It only reads: nothing is created and nothing is
 * written, so asking never adds a cookie or a storage entry to a site that had none.
 */
function readStoredPersistentId(): string | null {
  return localStorageLayer.read() ?? cookieLayer.read();
}

function resetPersistentIdForTesting(): void {
  memoryFallback = null;
}

export {
  COOKIE_NAME,
  isValidPersistentId,
  loadOrCreatePersistentId,
  type PersistentIdResult,
  readStoredPersistentId,
  resetPersistentIdForTesting,
  STORAGE_KEY,
};
