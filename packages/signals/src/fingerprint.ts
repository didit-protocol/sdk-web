import { detectBotFromNavigator } from "./device/bot";
import { canonicalNavigator, COMPOSITE_HASH_VERSION, compositeHashOf } from "./device/canonical";
import { payloadToHeaders } from "./device/headers";
import { collectNavigatorSignals } from "./device/signals/navigator";
import { detectWebViewContext } from "./device/signals/webview";
import { loadOrCreatePersistentId, resetPersistentIdForTesting } from "./device/storage";
import type { DeviceFingerprintPayload } from "./device/types";

/**
 * The device fingerprint this entry sends with events, transactions and sign-ins.
 *
 * One implementation, two sizes. The files under `device/` are the only place that knows how the
 * stored id is kept, which signals describe a device and how they become the composite hash. This
 * entry uses the part of them that fits its 5 KB promise (the stored id, the navigator and the
 * webview kind: the `lite` tier); `@didit-protocol/signals/device` uses all of them (the `full`
 * tier) and, once `enableDeviceIntelligence()` is called, is what this entry sends instead.
 */

/** Where the payload comes from when it is not the lite one built here. */
interface DeviceSignalsProvider {
  /** Collects the payload. A rejection is not kept: the next request asks again. */
  get: () => Promise<DeviceFingerprintPayload | null>;
  /** The payload if it is collected already, without waiting (a page that is closing cannot wait). */
  peek: () => DeviceFingerprintPayload | null;
}

let provider: DeviceSignalsProvider | null = null;
let cachedPayload: DeviceFingerprintPayload | null = null;
let pendingPayload: DeviceFingerprintPayload | null = null;
let cachedPayloadPromise: Promise<DeviceFingerprintPayload | null> | null = null;
/** Raised when the source of the payload changes, so a collection started before it is recognised. */
let generation = 0;

async function buildPayload(): Promise<DeviceFingerprintPayload> {
  // These layers answer at once, so the id is in the payload before anything is awaited.
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
    bot: detectBotFromNavigator(navigatorSignals),
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

function isBrowserEnvironment(): boolean {
  return typeof window !== "undefined" && typeof navigator !== "undefined" && typeof document !== "undefined";
}

/**
 * Collects the device fingerprint. Resolves to null outside a browser
 * environment (SSR, Node, workers) so callers degrade to a fingerprint-less
 * request instead of sending junk signals. Never intended to throw into the
 * submit path: callers still guard with .catch(() => null).
 */
export async function getDeviceFingerprintPayload(): Promise<DeviceFingerprintPayload | null> {
  if (!isBrowserEnvironment()) return null;
  if (cachedPayload) return cachedPayload;
  if (!cachedPayloadPromise) {
    const started = generation;
    cachedPayloadPromise = (provider ? provider.get() : buildPayload()).then(
      (payload) => {
        // The source changed while this was being collected (`enableDeviceIntelligence()` called
        // with the lite collection still running): its result must not become the cached payload,
        // and whoever waited for it gets the payload of the source that replaced it.
        if (started !== generation) return getDeviceFingerprintPayload();
        cachedPayload = payload;
        return payload;
      },
      (error) => {
        if (started !== generation) return getDeviceFingerprintPayload();
        // Do not cache failures; a later call may succeed.
        cachedPayloadPromise = null;
        throw error;
      }
    );
  }
  return cachedPayloadPromise;
}

/** Internal exit snapshot: never waits for WebCrypto or changes the cached payload. */
export function getAvailableDeviceFingerprintPayload(): DeviceFingerprintPayload | null {
  return cachedPayload ?? (provider ? provider.peek() : pendingPayload);
}

/**
 * Makes another collector the source of the fingerprint this entry sends (null: back to the lite
 * one). `enableDeviceIntelligence()` of `@didit-protocol/signals/device` calls it; nothing else should.
 */
export function setDeviceSignalsProvider(next: DeviceSignalsProvider | null): void {
  provider = next;
  generation += 1;
  cachedPayload = null;
  pendingPayload = null;
  cachedPayloadPromise = null;
}

/** The device headers a Didit API reads from the payload. */
export const buildFingerprintHeaders = payloadToHeaders;

export function resetDeviceFingerprintForTesting(): void {
  setDeviceSignalsProvider(null);
  resetPersistentIdForTesting();
}

export { randomBase64Url } from "./device/hash";
export type { DeviceSignalsProvider };
