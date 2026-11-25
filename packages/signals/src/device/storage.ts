import { randomBase64Url } from "./hash";

const STORAGE_KEY = "didit-pid-v1";
const COOKIE_NAME = "didit_pid";
/** The cookie's value among the page's cookies: the first one of that name. */
const COOKIE_VALUE = /(?:^|;\s*)didit_pid=([^;]*)/;
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 2;
const PERSISTENT_ID_BYTE_LENGTH = 16;

type StorageSource = "localStorage" | "cookie" | "memory" | "embedder" | "fresh";

interface PersistentIdResult {
  id: string;
  sources: StorageSource[];
  wasCreated: boolean;
}

let memoryFallback: string | null = null;

function isValidPersistentId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{20,32}$/.test(value);
}

/**
 * The id one of this entry's two stores holds, or null. `read` throws where the store does not
 * exist or may not be read (a worker, private mode, a storage policy): the store then answers
 * that it holds nothing, and the other one still applies.
 */
function held(read: () => string | null | undefined): string | null {
  try {
    const value = read();
    return isValidPersistentId(value) ? value : null;
  } catch {
    return null;
  }
}

const inLocalStorage = () => held(() => localStorage.getItem(STORAGE_KEY));
const inCookie = () =>
  held(() => {
    const found = document.cookie.match(COOKIE_VALUE);
    return found && decodeURIComponent(found[1]);
  });

/** Writes the id to the two stores that do not hold it yet. A store that refuses is left alone. */
function store(id: string, local: string | null, cookie: string | null): void {
  try {
    if (local !== id) localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage may be blocked: the cookie still applies.
  }
  try {
    if (cookie !== id) {
      const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${COOKIE_NAME}=${encodeURIComponent(id)}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
    }
  } catch {
    // No cookie either: the id lives in memory for this page.
  }
}

/**
 * The stored id from the two stores that answer at once (localStorage and a cookie), written back
 * to the one that missed it. The full collector keeps it in more stores, under the same
 * localStorage key and cookie name, so both agree on the id. Where the two hold different ids,
 * localStorage is the one kept: it is listed first, which is how the collector settles a tie
 * between two stores too.
 *
 * With no stored id, the device goes by the id of the page that embeds this one (`embedderId`),
 * when it passed it: that id is not written to any store and not kept in memory, because the
 * embedding page is where it lives and a value another page supplies never becomes this origin's
 * stored id. Otherwise it goes by the id kept in memory when storage is blocked, or a new one.
 */
function loadOrCreatePersistentId(embedderId?: string | null): PersistentIdResult {
  const local = inLocalStorage();
  const cookie = inCookie();
  const stored = local ?? cookie;
  if (!stored && isValidPersistentId(embedderId)) {
    return { id: embedderId, sources: ["embedder"], wasCreated: false };
  }

  const id = stored ?? memoryFallback ?? randomBase64Url(PERSISTENT_ID_BYTE_LENGTH);
  const sources: StorageSource[] = [];
  if (local === id) sources.push("localStorage");
  if (cookie === id) sources.push("cookie");
  if (!stored) sources.push(memoryFallback ? "memory" : "fresh");
  const result = { id, sources, wasCreated: !stored && !memoryFallback };
  memoryFallback = id;
  store(id, local, cookie);
  return result;
}

/**
 * The id this page already keeps, or null. It only reads: nothing is created and nothing is
 * written, so asking never adds a cookie or a storage entry to a site that had none.
 */
function readStoredPersistentId(): string | null {
  return inLocalStorage() ?? inCookie();
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
