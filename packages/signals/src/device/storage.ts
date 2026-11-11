import { randomBase64Url } from "./hash";

const STORAGE_KEY = "didit-pid-v1";
const COOKIE_NAME = "didit_pid";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 2;
const PERSISTENT_ID_BYTE_LENGTH = 16;

type StorageSource = "localStorage" | "idb" | "cookie" | "cache" | "memory" | "fresh";

/**
 * One place the stored id lives in. A layer that answers at once (localStorage, a cookie) returns
 * the value; one that has to wait (IndexedDB, Cache storage) returns a promise. Neither throws.
 */
interface StorageLayer {
  source: StorageSource;
  read: () => string | null | Promise<string | null>;
  write: (id: string) => boolean | Promise<boolean>;
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

const localStorageLayer: StorageLayer = {
  source: "localStorage",
  read() {
    try {
      if (typeof localStorage === "undefined") return null;
      const value = localStorage.getItem(STORAGE_KEY);
      return isValidPersistentId(value) ? value : null;
    } catch {
      // Storage may be blocked (private mode, storage policies): the other layers still apply.
      return null;
    }
  },
  write(id) {
    try {
      if (typeof localStorage === "undefined") return false;
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
      if (typeof document === "undefined" || !document.cookie) return null;
      const prefix = `${COOKIE_NAME}=`;
      for (const part of document.cookie.split(";")) {
        const trimmed = part.trim();
        if (trimmed.startsWith(prefix)) {
          const value = decodeURIComponent(trimmed.substring(prefix.length));
          return isValidPersistentId(value) ? value : null;
        }
      }
      return null;
    } catch {
      return null;
    }
  },
  write(id) {
    try {
      if (typeof document === "undefined") return false;
      const isSecure = typeof location !== "undefined" && location.protocol === "https:";
      const attributes = [
        `${COOKIE_NAME}=${encodeURIComponent(id)}`,
        "Path=/",
        `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
        "SameSite=Lax",
      ];
      if (isSecure) attributes.push("Secure");
      document.cookie = attributes.join("; ");
      return true;
    } catch {
      return false;
    }
  },
};

/** The layers every browser answers at once. `storage-layers.ts` adds the ones that have to wait. */
const SYNC_STORAGE_LAYERS: StorageLayer[] = [localStorageLayer, cookieLayer];

/** The value most layers agree on; on a tie, the layer listed first. */
function pickWinner(candidates: { id: string; source: StorageSource }[]): { id: string; sources: StorageSource[] } {
  const tally = new Map<string, StorageSource[]>();
  for (const { id, source } of candidates) {
    const existing = tally.get(id);
    if (existing) {
      existing.push(source);
    } else {
      tally.set(id, [source]);
    }
  }
  let winner = candidates[0].id;
  let winnerCount = 0;
  for (const [id, sources] of tally) {
    if (sources.length > winnerCount) {
      winnerCount = sources.length;
      winner = id;
    }
  }
  return { id: winner, sources: tally.get(winner) || [] };
}

/**
 * From what each layer answered: the id this browser profile is known by (the value most layers
 * agree on, the one kept in memory when storage is blocked, or a new random one), and the layers
 * that did not have it, for the caller to write it back to.
 */
function choosePersistentId(
  layers: StorageLayer[],
  values: (string | null)[],
): { result: PersistentIdResult; stale: StorageLayer[] } {
  const candidates: { id: string; source: StorageSource }[] = [];
  values.forEach((value, index) => {
    if (value) candidates.push({ id: value, source: layers[index].source });
  });
  if (!candidates.length && memoryFallback && isValidPersistentId(memoryFallback)) {
    candidates.push({ id: memoryFallback, source: "memory" });
  }

  let result: PersistentIdResult;
  if (candidates.length) {
    const winner = pickWinner(candidates);
    result = { id: winner.id, sources: winner.sources, wasCreated: false };
  } else {
    result = { id: randomBase64Url(PERSISTENT_ID_BYTE_LENGTH), sources: ["fresh"], wasCreated: true };
  }
  memoryFallback = result.id;
  return { result, stale: layers.filter((_, index) => values[index] !== result.id) };
}

/**
 * The stored id from the layers that answer at once (localStorage and a cookie), written back to
 * the one that missed it. `loadOrCreatePersistentIdFromBrowserStorage` (storage-layers.ts) reads
 * the slow layers too.
 */
function loadOrCreatePersistentId(): PersistentIdResult {
  const layers = SYNC_STORAGE_LAYERS;
  const { result, stale } = choosePersistentId(layers, layers.map((layer) => layer.read() as string | null));
  stale.forEach((layer) => layer.write(result.id));
  return result;
}

function resetPersistentIdForTesting(): void {
  memoryFallback = null;
}

export {
  choosePersistentId,
  COOKIE_NAME,
  isValidPersistentId,
  loadOrCreatePersistentId,
  type PersistentIdResult,
  resetPersistentIdForTesting,
  STORAGE_KEY,
  type StorageLayer,
  type StorageSource,
  SYNC_STORAGE_LAYERS,
};
