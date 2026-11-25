import { randomBase64Url } from "./hash";

const STORAGE_KEY = "didit-pid-v1";
const COOKIE_NAME = "didit_pid";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 2;
const PERSISTENT_ID_BYTE_LENGTH = 16;

type StorageSource = "localStorage" | "cookie" | "memory" | "fresh";

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

/**
 * The layers this entry keeps the id in. The full collector keeps it in more of them, under the
 * same localStorage key and cookie name, so both agree on the id.
 */
const STORAGE_LAYERS: StorageLayer[] = [localStorageLayer, cookieLayer];

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
 * the one that missed it.
 */
function loadOrCreatePersistentId(): PersistentIdResult {
  const layers = STORAGE_LAYERS;
  const { result, stale } = choosePersistentId(layers, layers.map((layer) => layer.read()));
  stale.forEach((layer) => layer.write(result.id));
  return result;
}

/**
 * The id this page already keeps, or null. It only reads: nothing is created and nothing is
 * written, so asking never adds a cookie or a storage entry to a site that had none.
 */
function readStoredPersistentId(): string | null {
  for (const layer of STORAGE_LAYERS) {
    const value = layer.read();
    if (value) return value;
  }
  return null;
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
