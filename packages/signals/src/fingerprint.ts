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
 * Two sizes of one fingerprint. This file builds the lite one (the stored id, the navigator and
 * the webview kind) because it is small enough to live in the core entry and answers at once. The
 * full one, with the automation evidence, comes from the collector, a separate file loaded after
 * the core. A request waits for at most COLLECTOR_WAIT_MS: for the collector, and then for what
 * is left of the lite payload. A slow or blocked file, or a hash that does not come, never delays
 * a request longer than that.
 *
 * One device has one id, and it is the one the page's two stores hold (localStorage and a
 * cookie): every payload is handed out with the id they hold at that moment. By default those two
 * stores are all there is, and an id the visitor cleared is gone. A page that asks for the durable
 * copies (`configureDevice({ durableDeviceId: true })`) has the collector keep the id in IndexedDB
 * and Cache storage too; a made-up id is then stored only once the collector has read every
 * store, so it cannot outvote an id one of them still holds.
 */

/** How long a request waits for its fingerprint before it goes out with what there is. */
const COLLECTOR_WAIT_MS = 2000;

type Waiter = (payload: DeviceFingerprintPayload | null) => void;

/** The lite payload: without its hash at first (what an exiting page can still send), then with it. */
let lite: DeviceFingerprintPayload | null = null;
let liteIsHashed = false;
let hashing = false;
let collectorPayload: DeviceFingerprintPayload | null = null;
/** The collection under way, if there is one. */
let collecting: object | null = null;
let embedderId: string | null = null;
let durableId = false;
const liteWaiters = new Set<Waiter>();
const collectorWaiters = new Set<Waiter>();

/**
 * Resolves with what `release` is called with, or with null once `ms` have passed. A caller whose
 * time ran out is forgotten then: nothing of it stays behind, however long the answer takes.
 */
function waitUpTo(waiters: Set<Waiter>, ms: number): Promise<DeviceFingerprintPayload | null> {
  return new Promise((resolve) => {
    const done: Waiter = (payload) => {
      clearTimeout(timer);
      waiters.delete(done);
      resolve(payload);
    };
    const timer = setTimeout(done, ms, null);
    waiters.add(done);
  });
}

function release(waiters: Set<Waiter>, payload: DeviceFingerprintPayload | null): void {
  for (const waiter of [...waiters]) waiter(payload);
}

/**
 * The payload as it is handed out: with the id the page's two stores hold now. They are where the
 * collector writes the id it settled on, at once or when a slow store answers later, so a payload
 * built before that still names the device the stores name.
 */
function published(payload: DeviceFingerprintPayload | null): DeviceFingerprintPayload | null {
  const stored = payload && readStoredPersistentId();
  return stored && stored.id !== payload.persistentId
    ? { ...payload, persistentId: stored.id, persistentIdSources: stored.sources, persistentIdWasCreated: false }
    : payload;
}

/**
 * Builds the lite payload once. What a browser answers at once (the stored id, the navigator, the
 * webview kind) is there when this returns; the hash follows, and whoever waits for it is told.
 */
function ensureLite(): void {
  if (!lite) {
    const stored = readStoredPersistentId();
    // With no stored id, a framed page goes by the id of the page that embeds it, which is never
    // stored here; any other page makes one up.
    const persistent =
      stored ?? (embedderId ? { id: embedderId, sources: ["embedder"], wasCreated: false } : newPersistentId());
    // The two stores are settled at once only where they are all there is. With the durable
    // copies on, the collector reads every store first: a copy written now would vote against an
    // id a slower store still holds.
    if (!durableId && persistent.sources[0] !== "embedder") storePersistentId(persistent.id);
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
      release(liteWaiters, lite);
    });
}

/**
 * Starts the collector's collection, unless one is under way or done. A failed load is not tried
 * again on this page; a failed collection is, by the next call. However many requests wait, the
 * collection has one handler, which tells them all.
 */
function startCollection(): void {
  if (collectorPayload || collecting) return;
  // The lite payload goes first, so the collector can be told the id this page made up.
  ensureLite();
  const madeUpId = lite?.persistentIdWasCreated ? lite.persistentId : null;
  const collection = (collecting = {});

  loadCollector()
    .then((collector) =>
      collector ? collector.collect({ embedderPersistentId: embedderId, newPersistentId: madeUpId, durableId }) : null,
    )
    .then(
      (payload): DeviceFingerprintPayload | null => payload,
      () => null,
    )
    .then((payload) => {
      // Another collection is under way only after a reset: this one has nobody to tell.
      if (collecting !== collection) return;
      collecting = null;
      collectorPayload = payload;
      // No collector on this page to settle the stores: the made-up id is stored here after all.
      if (!payload && madeUpId) storePersistentId(madeUpId);
      release(collectorWaiters, payload);
    });
}

/** The collector's payload if it is there within COLLECTOR_WAIT_MS, else null. Never rejects. */
function waitForCollector(): Promise<DeviceFingerprintPayload | null> {
  if (collectorPayload) return Promise.resolve(collectorPayload);
  const waited = waitUpTo(collectorWaiters, COLLECTOR_WAIT_MS);
  startCollection();
  return waited;
}

/**
 * Collects the device fingerprint: the collector's full payload when it arrives within
 * COLLECTOR_WAIT_MS of this call, else the lite one, which by then goes out without its hash if
 * the hash is not there either. Resolves to null outside a browser environment (SSR, Node,
 * workers) so callers degrade to a fingerprint-less request instead of sending junk signals.
 * Never intended to throw into the submit path: callers still guard with .catch(() => null).
 *
 * `{ tier: "lite" }` answers with the lite payload and never loads or waits for the collector. It
 * suits a request that only has to say which device it comes from.
 *
 * `{ wait: false }` never waits for anything: it answers at once with what there is. With
 * `tier: "lite"` that is the lite payload as it is now, so a first call on a page can come without
 * the hash and later ones carry it. Without it, the collector's payload if it has finished, else
 * the lite one, and the collector goes on loading.
 */
export async function getDeviceFingerprintPayload(options?: {
  tier?: "lite";
  wait?: boolean;
}): Promise<DeviceFingerprintPayload | null> {
  if (!isBrowserEnvironment()) return null;
  const waits = options?.wait !== false;
  const deadline = Date.now() + COLLECTOR_WAIT_MS;
  if (options?.tier !== "lite") {
    if (!waits) startCollection();
    const full = waits ? await waitForCollector() : collectorPayload;
    if (full) return published(full);
  }
  ensureLite();
  const left = deadline - Date.now();
  if (waits && !liteIsHashed && left > 0) await waitUpTo(liteWaiters, left);
  return published(lite);
}

/**
 * Internal exit snapshot: never waits, never starts a load and never changes what is cached. The
 * collector's payload if there is one, else the lite payload, with its hash or before it.
 */
export function getAvailableDeviceFingerprintPayload(): DeviceFingerprintPayload | null {
  let peeked: DeviceFingerprintPayload | null = null;
  try {
    peeked = getLoadedCollector()?.peek() ?? null;
  } catch {
    // A collector that throws is as good as one with nothing yet.
  }
  return published(collectorPayload ?? peeked ?? lite);
}

/**
 * The automation evidence of this page as compact JSON text, for a request your own backend sends
 * to Didit (for example a sign-in your server forwards). Didit's servers read it and decide the
 * score. Waits for the collector for at most 2 seconds; null outside a browser, when the
 * collector is not there in time, or when it failed. Never rejects.
 *
 * `{ wait: false }` never waits: it answers with the evidence if the collector has finished, else
 * with null, and lets the collector go on loading so a later call has it.
 */
export async function getSignalsEvidence(options?: { wait?: boolean }): Promise<string | null> {
  if (!isBrowserEnvironment()) return null;
  try {
    let collected = collectorPayload;
    if (!collected) {
      if (options?.wait === false) startCollection();
      else collected = await waitForCollector();
    }
    return collected ? (getLoadedCollector()?.evidence() ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * How this page keeps and names its device. Call it before the first event, transaction or
 * sign-in of the page; what it is given holds from then on.
 *
 * `durableDeviceId: true` also keeps the device id in IndexedDB and Cache storage, so that
 * clearing cookies or localStorage alone does not make a known device look new. It is off unless
 * you turn it on: by default the id lives in localStorage and a cookie, and an id your visitor
 * cleared is gone. Whether you may keep it longer than that is yours to decide, under the rules
 * your site follows.
 *
 * `embedderDeviceId` is for a page shown inside another site's frame: the device id the embedding
 * page keeps for Didit, when it passed one (`@didit-protocol/sdk-web` adds it to the verification
 * it opens as the `sdk_device_id` query parameter). The page goes by that id while its own storage
 * has none (a framed page's storage is kept apart per embedding site, and some browsers empty it
 * when they close), never writes it to its own storage, and reports it as `signals.embedder`,
 * which links what happens in the frame with the events of the site around it. Anything that is
 * not a device id is ignored, and `null` takes it back.
 */
export function configureDevice(options: { durableDeviceId?: boolean; embedderDeviceId?: string | null }): void {
  if ("durableDeviceId" in options) durableId = options.durableDeviceId === true;
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
  collecting = null;
  embedderId = null;
  durableId = false;
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
