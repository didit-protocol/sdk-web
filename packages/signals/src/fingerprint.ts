import { getLoadedCollector, isBrowserEnvironment, loadCollector, resetCollectorForTesting } from "./collector";
import { canonicalNavigator, COMPOSITE_HASH_VERSION, compositeHashOf } from "./device/canonical";
import { payloadToHeaders } from "./device/headers";
import { collectNavigatorSignals } from "./device/signals/navigator";
import { detectWebViewContext } from "./device/signals/webview";
import { loadOrCreatePersistentId, readStoredPersistentId, resetPersistentIdForTesting } from "./device/storage";
import type { DeviceFingerprintPayload } from "./device/types";

/**
 * The device fingerprint this entry sends with events, transactions and sign-ins.
 *
 * Two sizes of one fingerprint. This file builds the lite one (the stored id, the navigator and
 * the webview kind) because it is small enough to live in the core entry and answers at once. The
 * full one, with the automation evidence, comes from the collector, a separate file loaded after
 * the core. A request waits for the collector for at most COLLECTOR_WAIT_MS and goes out with the
 * lite payload when it is not there by then, so a slow or blocked file never delays a request.
 */

/** How long a request waits for the collector before it goes out with the lite payload. */
const COLLECTOR_WAIT_MS = 2000;

let litePayload: DeviceFingerprintPayload | null = null;
/** The lite payload before its hash is known: what an exiting page can still send. */
let pendingPayload: DeviceFingerprintPayload | null = null;
let litePromise: Promise<DeviceFingerprintPayload> | null = null;
let collectorPayload: DeviceFingerprintPayload | null = null;
let collecting: Promise<DeviceFingerprintPayload | null> | null = null;

async function buildLitePayload(): Promise<DeviceFingerprintPayload> {
  // These layers answer at once, so the id is stored before anything is awaited.
  const persistent = loadOrCreatePersistentId();
  const navigatorSignals = collectNavigatorSignals();
  const webview = detectWebViewContext(navigatorSignals.userAgent);
  const payload: DeviceFingerprintPayload = {
    version: 2,
    schema: "didit-fp-v2",
    platform: "web",
    collectedAt: new Date().toISOString(),
    persistentId: persistent.id,
    persistentIdSources: persistent.sources,
    persistentIdWasCreated: persistent.wasCreated,
    signals: {
      platform: "web",
      tier: "lite",
      compositeHashVersion: COMPOSITE_HASH_VERSION,
      navigator: navigatorSignals,
      webview,
    },
    compositeHash: "",
  };

  // Keep all synchronously collected context available during the native hash.
  // An empty hash is omitted from headers, never replaced with a different identity.
  pendingPayload = payload;
  const compositeHash = await compositeHashOf({
    navigator: canonicalNavigator(navigatorSignals),
    webview: webview.kind,
  });
  return { ...payload, compositeHash };
}

/** Builds the lite payload once. The stored id exists as soon as this returns. */
function ensureLitePayload(): Promise<DeviceFingerprintPayload> {
  if (!litePromise) {
    litePromise = buildLitePayload().then(
      (payload) => {
        litePayload = payload;
        return payload;
      },
      (error) => {
        // Do not cache failures; a later call may succeed.
        litePromise = null;
        throw error;
      },
    );
  }
  return litePromise;
}

/**
 * Starts the collector's collection, or joins the one under way. Resolves to its payload, or to
 * null when it cannot load or fails. A failed load is not tried again on this page; a failed
 * collection is, on the next call.
 */
function startCollection(): Promise<DeviceFingerprintPayload | null> {
  if (collectorPayload) return Promise.resolve(collectorPayload);
  if (!collecting) {
    const attempt: Promise<DeviceFingerprintPayload | null> = loadCollector()
      .then((collector) => (collector ? collector.collect() : null))
      .then(
        (payload) => {
          if (payload) collectorPayload = payload;
          return payload ?? null;
        },
        () => null,
      )
      .then((payload) => {
        if (collecting === attempt) collecting = null;
        return payload;
      });
    collecting = attempt;
  }
  return collecting;
}

/** The collector's payload if it arrives within COLLECTOR_WAIT_MS, else null. Never rejects. */
function waitForCollector(): Promise<DeviceFingerprintPayload | null> {
  if (collectorPayload) return Promise.resolve(collectorPayload);
  // The lite payload goes first: it stores the device id before the collector starts.
  ensureLitePayload().catch(() => undefined);
  const collection = startCollection();

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), COLLECTOR_WAIT_MS);
    collection.then((payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/**
 * Collects the device fingerprint: the collector's full payload when it arrives within
 * COLLECTOR_WAIT_MS of this call, else the lite one. Resolves to null outside a browser
 * environment (SSR, Node, workers) so callers degrade to a fingerprint-less request instead of
 * sending junk signals. Never intended to throw into the submit path: callers still guard with
 * .catch(() => null).
 */
export async function getDeviceFingerprintPayload(): Promise<DeviceFingerprintPayload | null> {
  if (!isBrowserEnvironment()) return null;
  const full = await waitForCollector();
  return full ?? ensureLitePayload();
}

/**
 * Internal exit snapshot: never waits, never starts a load and never changes what is cached. The
 * collector's payload if there is one, else the lite payload, else the lite one before its hash.
 */
export function getAvailableDeviceFingerprintPayload(): DeviceFingerprintPayload | null {
  if (collectorPayload) return collectorPayload;
  try {
    const peeked = getLoadedCollector()?.peek() ?? null;
    if (peeked) return peeked;
  } catch {
    // A collector that throws is as good as one with nothing yet.
  }
  return litePayload ?? pendingPayload;
}

/**
 * The automation evidence of this page as compact JSON text, for a request your own backend sends
 * to Didit (for example a sign-in your server forwards). Didit's servers read it and decide the
 * score. Waits for the collector for at most 2 seconds; null outside a browser, when the
 * collector is not there in time, or when it failed. Never rejects.
 */
export async function getSignalsEvidence(): Promise<string | null> {
  if (!isBrowserEnvironment()) return null;
  try {
    if (!(await waitForCollector())) return null;
    return getLoadedCollector()?.evidence() ?? null;
  } catch {
    return null;
  }
}

/** The device headers a Didit API reads from the payload. */
export const buildFingerprintHeaders = payloadToHeaders;

/**
 * The device id this page already keeps for Didit, or null when it keeps none. It never creates
 * one: `@didit-protocol/sdk-web` hands it to the verification it opens, so a site that sends no
 * events, transactions or sign-ins gets no cookie and no storage entry from being asked.
 */
export const getStoredDeviceId = readStoredPersistentId;

export function resetDeviceFingerprintForTesting(): void {
  litePayload = null;
  pendingPayload = null;
  litePromise = null;
  collectorPayload = null;
  collecting = null;
  resetCollectorForTesting();
  resetPersistentIdForTesting();
}

export { randomBase64Url } from "./device/hash";
export { COLLECTOR_WAIT_MS };
