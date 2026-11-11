import { collectApiBitmap } from "./signals/api";
import { collectAudioSignals } from "./signals/audio";
import { collectCanvasSignals } from "./signals/canvas";
import { collectCodecSignals } from "./signals/codecs";
import { collectEnvironmentSignals } from "./signals/environment";
import { collectFontSignals } from "./signals/fonts";
import { collectHardwareSignals } from "./signals/hardware";
import { collectMathSignals } from "./signals/math";
import { collectNavigatorSignals } from "./signals/navigator";
import { collectWebGLSignals } from "./signals/webgl";
import { detectWebViewContext } from "./signals/webview";
import { type CollectedSignals, composePayload } from "./compose";
import { type PersistentIdResult } from "./storage";
import { loadOrCreatePersistentIdFromBrowserStorage } from "./storage-layers";
import { type FullDeviceFingerprintPayload } from "./types";

interface BuildOptions {
  /** How long the canvas, audio and hardware probes may take together before they are left out. */
  budgetMs?: number;
}

const DEFAULT_BUDGET_MS = 800;

function withBudget<T>(promise: Promise<T>, budgetMs: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, budgetMs);
    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

let cachedPayloadPromise: Promise<FullDeviceFingerprintPayload> | null = null;
let cachedPayload: FullDeviceFingerprintPayload | null = null;

/**
 * Lets the browser paint and answer a tap between collectors. Run back to back they are one long
 * task on a slow phone, in the middle of whatever the page is showing. `scheduler.yield` resumes
 * ahead of other queued work where it exists.
 */
function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === "function") return scheduler.yield();
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function buildPayload(options?: BuildOptions): Promise<FullDeviceFingerprintPayload> {
  const budget = options?.budgetMs ?? DEFAULT_BUDGET_MS;
  const perCollectorBudget = Math.max(50, Math.floor(budget / 2));

  const navigatorSignals = collectNavigatorSignals();
  const apiBitmap = collectApiBitmap();
  const mathSignals = collectMathSignals();
  await yieldToMain();
  const webgl = collectWebGLSignals();
  await yieldToMain();
  const webview = detectWebViewContext(navigatorSignals.userAgent);
  const codecs = collectCodecSignals();
  await yieldToMain();
  const environment = collectEnvironmentSignals(webgl, navigatorSignals);
  await yieldToMain();
  // Measured here, in short tasks of its own (a pass of a few fonts each), and not inside the budget
  // below: started later than the budget's timer it could miss it on a busy page and change the
  // device's hash.
  const fontSignals = await collectFontSignals(yieldToMain);
  await yieldToMain();

  const [persistent, canvas, audio, hardware] = await Promise.all([
    // Not under the budget: the stored id is the device's identity, and each storage layer already
    // gives up on its own (LAYER_TIMEOUT_MS). Under it, one long task on a busy page lets the
    // budget's timer run before the read's answer, and the request goes out with no stored id at
    // all while the id sits untouched in storage.
    loadOrCreatePersistentIdFromBrowserStorage().catch(() => {
      return { id: "", sources: [], wasCreated: false } as PersistentIdResult;
    }),
    withBudget(collectCanvasSignals(), perCollectorBudget, { pngHash: "", chunkSketch: [], blocked: true }),
    withBudget(collectAudioSignals(), perCollectorBudget, { sum: "", blocked: true }),
    withBudget(collectHardwareSignals(), perCollectorBudget, {
      batteryLevelQuantized: null,
      batteryCharging: null,
      mediaDevicesKinds: {},
      speechSynthesisVoices: null,
      storageQuota: null,
      storageUsage: null,
    }),
  ]);

  const signals: CollectedSignals = {
    navigator: navigatorSignals,
    canvas,
    webgl,
    audio,
    fonts: fontSignals,
    math: mathSignals,
    apiBitmap: apiBitmap.hex,
    apiMissing: apiBitmap.missing,
    hardware,
    webview,
    codecs,
    environment,
  };

  return composePayload({ persistent, signals });
}

/**
 * The full device fingerprint of this browser: the stored id, the composite hash and every signal
 * family. Collected once per page and reused; a failed collection is not kept, so the next call
 * tries again.
 */
async function getFingerprintPayload(options?: BuildOptions): Promise<FullDeviceFingerprintPayload> {
  if (cachedPayload) return cachedPayload;
  if (!cachedPayloadPromise) {
    cachedPayloadPromise = buildPayload(options).then(
      (payload) => {
        cachedPayload = payload;
        return payload;
      },
      (error) => {
        cachedPayloadPromise = null;
        throw error;
      },
    );
  }
  return cachedPayloadPromise;
}

/** The id to know this device by: the stored id, or the composite hash where storage is blocked. */
async function getCompositeDeviceId(options?: BuildOptions): Promise<string> {
  const payload = await getFingerprintPayload(options);
  return payload.persistentId || payload.compositeHash || payload.legacyCompatibilityHash || "";
}

/** The payload if it has been collected already; null while it has not. Never starts a collection. */
function getCachedFingerprintPayload(): FullDeviceFingerprintPayload | null {
  return cachedPayload;
}

function resetFingerprintCacheForTesting(): void {
  cachedPayload = null;
  cachedPayloadPromise = null;
}

export {
  type BuildOptions,
  buildPayload,
  getCachedFingerprintPayload,
  getCompositeDeviceId,
  getFingerprintPayload,
  resetFingerprintCacheForTesting,
  withBudget,
  yieldToMain,
};
