/**
 * `@didit-protocol/signals/device`: the full device fingerprint.
 *
 * The entry `@didit-protocol/signals` sends a light fingerprint (the stored id, the navigator, the
 * webview kind) to stay small. This one collects every signal family: graphics, fonts, math, API
 * support, canvas, audio, hardware, codecs and whether the page runs on emulated hardware, and
 * keeps the stored id in every storage a browser has, so clearing one does not make a known device
 * look new. It is the collector Didit's own hosted verification flow uses.
 *
 * ```ts
 * import { enableDeviceIntelligence } from "@didit-protocol/signals/device";
 *
 * enableDeviceIntelligence(); // events, transactions and sign-ins now carry the full fingerprint
 * ```
 */
import { setDeviceSignalsProvider } from "@didit-protocol/signals";

import { type BuildOptions, getCachedFingerprintPayload, getFingerprintPayload } from "./device/index";

/**
 * Makes the full fingerprint the one `@didit-protocol/signals` sends with events, transactions and
 * Authentication requests, from the next request on. Call it once, when your app starts. The
 * collection itself starts with the first request (or when you call `getFingerprintPayload()`),
 * and is spread over short tasks so the page stays responsive.
 */
function enableDeviceIntelligence(options?: BuildOptions): void {
  setDeviceSignalsProvider({
    get: () => getFingerprintPayload(options),
    peek: getCachedFingerprintPayload,
  });
}

export { enableDeviceIntelligence };
export {
  type BuildOptions,
  buildPayload,
  getCachedFingerprintPayload,
  getCompositeDeviceId,
  getFingerprintPayload,
  resetFingerprintCacheForTesting,
} from "./device/index";
export { type BotDetection, detectBot, detectBotFromNavigator } from "./device/bot";
export { canonicalNavigator, COMPOSITE_HASH_VERSION } from "./device/canonical";
export { canonicalize } from "./device/compose";
export { bytesToBase64Url, bytesToHex, randomBase64Url, sha256_128, sha256Base64Url, sha256Bytes, sha256Hex } from "./device/hash";
export { attachFingerprintPayload, payloadToHeaders } from "./device/headers";
export {
  COOKIE_NAME,
  isValidPersistentId,
  loadOrCreatePersistentId,
  type PersistentIdResult,
  resetPersistentIdForTesting,
  STORAGE_KEY,
  type StorageLayer,
  type StorageSource,
} from "./device/storage";
export { BROWSER_STORAGE_LAYERS, loadOrCreatePersistentIdFromBrowserStorage } from "./device/storage-layers";
export { collectApiBitmap } from "./device/signals/api";
export { type AudioSignals, collectAudioSignals } from "./device/signals/audio";
export { type CanvasSignals, collectCanvasSignals } from "./device/signals/canvas";
export { type CodecSignals, collectCodecSignals } from "./device/signals/codecs";
export { collectEnvironmentSignals, type EnvironmentSignals } from "./device/signals/environment";
export { collectFontSignals, type FontSignals } from "./device/signals/fonts";
export { collectHardwareSignals, type HardwareSignals } from "./device/signals/hardware";
export { collectMathSignals, type MathSignals } from "./device/signals/math";
export { collectNavigatorSignals, type NavigatorSignals } from "./device/signals/navigator";
export { canonicalRendererKey, collectWebGLSignals, type WebGLSignals } from "./device/signals/webgl";
export { detectWebViewContext, type WebViewKind, type WebViewSignals } from "./device/signals/webview";
export {
  type DeviceFingerprintPayload,
  type DeviceSignals,
  type FullDeviceFingerprintPayload,
  type FullDeviceSignals,
} from "./device/types";
