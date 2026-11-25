import { randomBase64Url } from "./hash";

const STORAGE_KEY = "didit-pid-v1";
const COOKIE_NAME = "didit_pid";
/** The cookie's value among the page's cookies: the first one of that name. */
const COOKIE_VALUE = /(?:^|;\s*)didit_pid=([^;]*)/;
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 2;
const PERSISTENT_ID_BYTE_LENGTH = 16;

type StorageSource = "localStorage" | "cookie" | "embedder" | "fresh";

interface PersistentIdResult {
  id: string;
  sources: StorageSource[];
  wasCreated: boolean;
}

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

/**
 * The id the page's two stores hold now (localStorage and a cookie), and which of them hold it, or
 * null when neither does. It only reads. Where the two hold different ids, localStorage is the one
 * that counts: it is listed first, which is how the collector settles a tie between two stores too.
 */
function readStoredPersistentId(): PersistentIdResult | null {
  const local = inLocalStorage();
  const cookie = inCookie();
  const id = local ?? cookie;
  if (!id) return null;
  const sources: StorageSource[] = local === id ? ["localStorage"] : [];
  if (cookie === id) sources.push("cookie");
  return { id, sources, wasCreated: false };
}

/** Writes the id to whichever of the two stores does not hold it. A store that refuses is left alone. */
function storePersistentId(id: string): void {
  try {
    if (inLocalStorage() !== id) localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage may be blocked: the cookie still applies.
  }
  try {
    if (inCookie() !== id) {
      const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${COOKIE_NAME}=${encodeURIComponent(id)}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
    }
  } catch {
    // No cookie either: the id lives in memory for this page.
  }
}

/** A new id, made up for a device no store names. */
function newPersistentId(): PersistentIdResult {
  return { id: randomBase64Url(PERSISTENT_ID_BYTE_LENGTH), sources: ["fresh"], wasCreated: true };
}

export {
  COOKIE_NAME,
  isValidPersistentId,
  newPersistentId,
  type PersistentIdResult,
  readStoredPersistentId,
  STORAGE_KEY,
  storePersistentId,
};
