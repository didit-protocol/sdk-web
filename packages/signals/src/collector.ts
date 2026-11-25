import type { DeviceFingerprintPayload, DeviceSignals } from "./device/types";

/**
 * The only module that touches the vendored device collector (`vendor/collector.mjs`).
 *
 * The collector is a built file that Didit ships with this package and that is not part of this
 * source tree. The core entry loads it with a dynamic `import()` after the page's own work, so
 * the 6 KB core stays small and a page that never sends anything never downloads it.
 */

/**
 * The payload as the collector hands it over. It is the published payload, typed by the members
 * this package names: the collector declares a closed set of signal families, and the published
 * type keeps the further families open (`[family: string]`), which a closed declaration cannot be
 * read through. Typed this way, the collector's own declarations are checked against every member
 * named here (__tests__/collector-types.test.ts), and the payload is then handed out under the
 * published type. It is narrower than the published type where the collector must be: its payload
 * is the full one and always carries the evidence.
 */
type CollectedPayload = Omit<DeviceFingerprintPayload, "signals" | "evidence"> & {
  /** Required here, optional in the published payload: only the lite payload has none. */
  evidence: string;
  signals: Pick<DeviceSignals, "platform" | "compositeHashVersion" | "navigator" | "webview" | "embedder"> & {
    tier: "full";
  };
};

/** What this package uses of the collector. Declared here so the public types never name its file. */
interface DeviceCollector {
  version: string;
  /**
   * `embedderPersistentId` is the id the embedding page passed, `newPersistentId` the id this
   * package made up on this page load before the collector read the stores, if it made one up.
   * `durableId: false` keeps the id in localStorage and the cookie only: the collector then
   * neither reads nor writes IndexedDB and Cache storage.
   */
  collect: (options?: {
    embedderPersistentId?: string | null;
    newPersistentId?: string | null;
    durableId?: boolean;
  }) => Promise<CollectedPayload>;
  /** The payload if it is collected already; never starts a collection. */
  peek: () => CollectedPayload | null;
  /** Compact JSON text, synchronous, complete once `collect()` has resolved. */
  evidence: () => string;
}

type CollectorLoader = () => Promise<DeviceCollector>;

// "didit-signals-collector" is not a package: the build resolves it (see rollup-collector.js). The
// core builds leave it as a relative import of a file copied next to them, the script-tag build
// inlines it. Its types are checked against the vendored declarations in __tests__/collector-types.test.ts.
// @ts-ignore - only the build can resolve this name
const defaultLoader: CollectorLoader = () => import("didit-signals-collector") as Promise<DeviceCollector>;

let loader: CollectorLoader = defaultLoader;
let loading: Promise<DeviceCollector | null> | null = null;
let loaded: DeviceCollector | null = null;

function isBrowserEnvironment(): boolean {
  return typeof window !== "undefined" && typeof navigator !== "undefined" && typeof document !== "undefined";
}

/**
 * The collector, or null where there is no browser or it could not be loaded. Loaded once per
 * page: a failed load is not tried again, because a page that blocks the file would only wait
 * for the same refusal on every request.
 */
function loadCollector(): Promise<DeviceCollector | null> {
  if (!isBrowserEnvironment()) return Promise.resolve(null);
  if (!loading) {
    loading = Promise.resolve()
      .then(() => loader())
      .then(
        (collector) => {
          loaded = collector;
          return collector;
        },
        () => null,
      );
  }
  return loading;
}

/** The collector if it is loaded already. Never starts a load. */
function getLoadedCollector(): DeviceCollector | null {
  return loaded;
}

/** Forgets what was loaded, so the next request loads again. */
function resetCollectorForTesting(): void {
  loading = null;
  loaded = null;
}

/** Replaces how the collector is loaded (null restores the real one) and forgets what was loaded. */
function setCollectorLoaderForTesting(next: CollectorLoader | null): void {
  loader = next ?? defaultLoader;
  resetCollectorForTesting();
}

export {
  type CollectedPayload,
  type DeviceCollector,
  getLoadedCollector,
  isBrowserEnvironment,
  loadCollector,
  resetCollectorForTesting,
  setCollectorLoaderForTesting,
};
