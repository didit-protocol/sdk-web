import { getLoadedCollector, isBrowserEnvironment, loadCollector, resetCollectorForTesting } from "./collector";
import { canonicalNavigator, COMPOSITE_HASH_VERSION, compositeHashOf } from "./device/canonical";
import { payloadToHeaders } from "./device/headers";
import { collectNavigatorSignals } from "./device/signals/navigator";
import { detectWebViewContext, webViewKindForVersion4Hash } from "./device/signals/webview";
import { isValidPersistentId, newPersistentId, readStoredPersistentId, storePersistentId } from "./device/storage";
import type { DeviceFingerprintPayload } from "./device/types";

/**
 * The device fingerprint this entry sends with events, transactions and sign-ins.
 *
 * This file builds the lite fingerprint (the stored id, the navigator and the webview kind): it
 * is small enough to live in the core entry and answers at once. The collector, a separate file
 * loaded after the core, adds the automation evidence: facts about how the page is driven, which
 * Didit's servers read to decide a score. By default that is all it does: it reads no canvas, no
 * audio, no fonts and no graphics, and stores nothing. A page that asks for the full fingerprint
 * (`configureDevice({ fullFingerprint: true })`) has the collector collect it as well.
 *
 * A request waits for at most COLLECTOR_WAIT_MS: for the collector, and then for what is left of
 * the lite payload. A slow or blocked file, or a hash that does not come, never delays a request
 * longer than that.
 *
 * The device id lives in the page's two stores, localStorage and a cookie, in every case: the
 * collector is told to keep to them too, and every payload is handed out with the id they hold.
 */

/** How long a request waits for its fingerprint before it goes out with what there is. */
const COLLECTOR_WAIT_MS = 2000;

type Waiter = () => void;

/** The lite payload: without its hash at first (what an exiting page can still send), then with it. */
let lite: DeviceFingerprintPayload | null = null;
let liteIsHashed = false;
let hashing = false;
/** The collector's full payload, for a page that asked for the full fingerprint. */
let collectorPayload: DeviceFingerprintPayload | null = null;
/** Whether the collector is there: loaded, and done collecting where the full fingerprint is on. */
let collectorIsReady = false;
/** The start of the collector under way, if there is one. */
let starting: object | null = null;
/** The evidence as it was last read. An exiting page sends this one: it does not read again. */
let lastEvidence: string | undefined;
let embedderId: string | null = null;
let fullFingerprint = false;
const liteWaiters = new Set<Waiter>();
const collectorWaiters = new Set<Waiter>();

/**
 * Resolves when `release` is called, or once `ms` have passed. A caller whose time ran out is
 * forgotten then: nothing of it stays behind, however long the answer takes.
 */
function waitUpTo(waiters: Set<Waiter>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done: Waiter = () => {
      clearTimeout(timer);
      waiters.delete(done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    waiters.add(done);
  });
}

function release(waiters: Set<Waiter>): void {
  for (const waiter of [...waiters]) waiter();
}

/**
 * The payload as it is handed out: with the id the page's two stores hold now (another tab may
 * have settled it since this page read them), and with the evidence where `evidence` gives one.
 */
function handOut(payload: DeviceFingerprintPayload | null, evidence?: string): DeviceFingerprintPayload | null {
  if (!payload) return null;
  const stored = readStoredPersistentId();
  return {
    ...payload,
    ...(stored && stored.id !== payload.persistentId
      ? { persistentId: stored.id, persistentIdSources: stored.sources, persistentIdWasCreated: false }
      : {}),
    ...(evidence ? { evidence } : {}),
  };
}

/** The evidence as the collector reads it now, or undefined while the collector is not there. */
function readEvidence(): string | undefined {
  if (!collectorIsReady) return undefined;
  try {
    lastEvidence = getLoadedCollector()?.evidence() ?? lastEvidence;
  } catch {
    // A collector that throws leaves the evidence as it was last read.
  }
  return lastEvidence;
}

/**
 * Builds the lite payload once. What a browser answers at once (the stored id, the navigator, the
 * webview kind) is there when this returns; the hash follows, and whoever waits for it is told.
 */
function ensureLite(): void {
  if (!lite) {
    const stored = readStoredPersistentId();
    // With no stored id, a framed page goes by the id of the page that embeds it, which is never
    // stored here; any other page makes one up and stores it at once.
    const persistent =
      stored ?? (embedderId ? { id: embedderId, sources: ["embedder"], wasCreated: false } : newPersistentId());
    if (stored || !embedderId) storePersistentId(persistent.id);
    const navigatorSignals = collectNavigatorSignals();
    lite = {
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
        webview: detectWebViewContext(navigatorSignals.userAgent),
        ...(embedderId ? { embedder: { persistentId: embedderId } } : {}),
      },
      // An empty hash is omitted from headers, never replaced with a different identity.
      compositeHash: "",
    };
  }
  if (liteIsHashed || hashing) return;

  hashing = true;
  const { signals } = lite;
  compositeHashOf({
    navigator: canonicalNavigator(signals.navigator),
    webview: webViewKindForVersion4Hash(signals.navigator.userAgent),
  })
    .then(
      (compositeHash) => compositeHash,
      // A hash that failed is tried again by the next call; until then the payload has none.
      () => null,
    )
    .then((compositeHash) => {
      // Another payload is there only after a reset, and then this hash is not its hash.
      if (lite?.signals !== signals) return;
      hashing = false;
      if (compositeHash !== null) {
        lite = { ...lite, compositeHash };
        liteIsHashed = true;
      }
      release(liteWaiters);
    });
}

/**
 * Loads the collector, unless that is under way or done, and has it collect the full fingerprint
 * where the page asked for it. A failed load is not tried again on this page; a failed collection
 * is, by the next call. However many requests wait, there is one handler, which tells them all.
 */
function startCollector(): void {
  if (collectorIsReady || starting) return;
  // The lite payload goes first, so the collector can be told the id this page made up.
  ensureLite();
  const madeUpId = lite?.persistentIdWasCreated ? lite.persistentId : null;
  const start = (starting = {});

  loadCollector()
    .then(async (collector) => {
      if (!collector) return false;
      if (fullFingerprint) {
        // The id stays in the page's two stores: the collector reads and writes no other.
        const payload = await collector.collect({
          embedderPersistentId: embedderId,
          newPersistentId: madeUpId,
          durableId: false,
        });
        if (starting === start) collectorPayload = payload;
      }
      return true;
    })
    .catch(() => false)
    .then((isReady) => {
      // Another start is under way only after a reset: this one has nobody to tell.
      if (starting !== start) return;
      starting = null;
      collectorIsReady = isReady;
      // Read once now, so a page that exits before its next request still has the evidence.
      if (isReady) readEvidence();
      release(collectorWaiters);
    });
}

/** Resolves once the collector is there, or after COLLECTOR_WAIT_MS. Never rejects. */
async function waitForCollector(): Promise<void> {
  startCollector();
  if (!collectorIsReady) await waitUpTo(collectorWaiters, COLLECTOR_WAIT_MS);
}

/**
 * Collects the device fingerprint: the lite payload with the collector's `evidence`, or, on a page
 * that asked for the full fingerprint, the collector's full payload. It waits for the collector for
 * at most COLLECTOR_WAIT_MS and otherwise goes out with the lite payload alone, which by then is
 * without its hash if the hash is not there either. Resolves to null outside a browser environment
 * (SSR, Node, workers) so callers degrade to a fingerprint-less request instead of sending junk
 * signals. Never intended to throw into the submit path: callers still guard with .catch(() => null).
 *
 * `{ tier: "lite" }` answers with the lite payload alone and never loads or waits for the
 * collector. It suits a request that only has to say which device it comes from.
 *
 * `{ wait: false }` never waits for anything: it answers at once with what there is. With
 * `tier: "lite"` that is the lite payload as it is now, so a first call on a page can come without
 * the hash and later ones carry it. Without it, the collector goes on loading.
 */
export async function getDeviceFingerprintPayload(options?: {
  tier?: "lite";
  wait?: boolean;
}): Promise<DeviceFingerprintPayload | null> {
  if (!isBrowserEnvironment()) return null;
  const waits = options?.wait !== false;
  const withCollector = options?.tier !== "lite";
  const deadline = Date.now() + COLLECTOR_WAIT_MS;
  if (withCollector) {
    if (waits) await waitForCollector();
    else startCollector();
    if (collectorPayload) return handOut(collectorPayload, readEvidence());
  }
  ensureLite();
  const left = deadline - Date.now();
  if (waits && !liteIsHashed && left > 0) await waitUpTo(liteWaiters, left);
  return handOut(lite, withCollector ? readEvidence() : undefined);
}

/**
 * Internal exit snapshot: never waits, never starts a load and never reads the page again. The
 * collector's payload if there is one, else the lite payload, with its hash or before it, and the
 * evidence as it was last read.
 */
export function getAvailableDeviceFingerprintPayload(): DeviceFingerprintPayload | null {
  return handOut(collectorPayload ?? lite, lastEvidence);
}

/**
 * The automation evidence of this page as compact JSON text, for a request your own backend sends
 * to Didit (for example a sign-in your server forwards). Didit's servers read it and decide the
 * score. Waits for the collector for at most 2 seconds; null outside a browser, when the
 * collector is not there in time, or when it failed. Never rejects.
 *
 * `{ wait: false }` never waits: it answers with the evidence if the collector is there, else
 * with null, and lets the collector go on loading so a later call has it.
 */
export async function getSignalsEvidence(options?: { wait?: boolean }): Promise<string | null> {
  if (!isBrowserEnvironment()) return null;
  try {
    if (options?.wait === false) startCollector();
    else await waitForCollector();
    return readEvidence() ?? null;
  } catch {
    return null;
  }
}

/**
 * How this page names its device and how much it reads of it. Call it before the first event,
 * transaction or sign-in of the page; what it is given holds from then on.
 *
 * `fullFingerprint: true` adds the full device fingerprint to what the page sends: the graphics,
 * font, math, canvas, audio, hardware and codec signals. It is off unless you turn it on. By
 * default the page sends the lite fingerprint and the automation evidence, and reads nothing else
 * of the device.
 *
 * `embedderDeviceId` is for a page shown inside another site's frame: the device id the embedding
 * page keeps for Didit, when it passed one (`@didit-protocol/sdk-web` adds it to the verification
 * it opens as the `sdk_device_id` query parameter). The page goes by that id while its own storage
 * has none (a framed page's storage is kept apart per embedding site, and some browsers empty it
 * when they close), never writes it to its own storage, and reports it as `signals.embedder`,
 * which links what happens in the frame with the events of the site around it. Anything that is
 * not a device id is ignored, and `null` takes it back.
 */
export function configureDevice(options: { fullFingerprint?: boolean; embedderDeviceId?: string | null }): void {
  if ("fullFingerprint" in options) fullFingerprint = options.fullFingerprint === true;
  if ("embedderDeviceId" in options) {
    embedderId = isValidPersistentId(options.embedderDeviceId) ? options.embedderDeviceId : null;
  }
}

/** The device headers a Didit API reads from the payload. */
export const buildFingerprintHeaders = payloadToHeaders;

/**
 * The device id this page already keeps for Didit, or null when it keeps none. It never creates
 * one: `@didit-protocol/sdk-web` hands it to the verification it opens, so a site that sends no
 * events, transactions or sign-ins gets no cookie and no storage entry from being asked.
 */
export const getStoredDeviceId = (): string | null => readStoredPersistentId()?.id ?? null;

export function resetDeviceFingerprintForTesting(): void {
  lite = null;
  liteIsHashed = false;
  hashing = false;
  collectorPayload = null;
  collectorIsReady = false;
  starting = null;
  lastEvidence = undefined;
  embedderId = null;
  fullFingerprint = false;
  liteWaiters.clear();
  collectorWaiters.clear();
  resetCollectorForTesting();
}

/** How many callers are waiting for a payload right now. */
export function waitingCountForTesting(): number {
  return liteWaiters.size + collectorWaiters.size;
}

export { randomBase64Url } from "./device/hash";
export { COLLECTOR_WAIT_MS };
