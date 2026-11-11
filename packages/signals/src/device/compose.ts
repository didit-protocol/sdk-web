import { type BotDetection, detectBot } from "./bot";
import { canonicalNavigator, COMPOSITE_HASH_VERSION, compositeHashOf } from "./canonical";
import { type PersistentIdResult } from "./storage";
import { canonicalRendererKey } from "./signals/webgl";
import { type FullDeviceFingerprintPayload, type FullDeviceSignals } from "./types";

/** The signal families a collector fills in; `composePayload` adds what is the same for every payload. */
type CollectedSignals = Omit<FullDeviceSignals, "platform" | "tier" | "compositeHashVersion">;

/**
 * The fields the full composite hash is made of: what describes the device and its browser, and
 * reads the same on every visit.
 *
 * Left out on purpose, although collected: the canvas and audio renders (read inside a time budget
 * a busy page outruns, and blurred on purpose by privacy browsers), the number of media devices (a
 * browser answers one placeholder per kind until the camera permission is granted) and every
 * version number (see `canonicalNavigator`). Everything read here is synchronous, or the font
 * probe, which runs outside the budget, so the hash does not depend on how busy the page was.
 *
 * The left-out signals stay in the payload. A change here changes every device's hash once: raise
 * COMPOSITE_HASH_VERSION with it.
 */
function canonicalize(signals: CollectedSignals) {
  return {
    navigator: canonicalNavigator(signals.navigator),
    webgl: {
      rendererKey: canonicalRendererKey(signals.webgl),
      version: signals.webgl.version,
      glslVersion: signals.webgl.shadingLanguageVersion,
      maxTextureSize: signals.webgl.maxTextureSize,
      maxViewport: signals.webgl.maxViewportDims,
      extensions: signals.webgl.extensions,
    },
    fonts: { available: signals.fonts.available },
    math: signals.math,
    api: signals.apiBitmap,
    webview: signals.webview.kind,
  };
}

// FNV-1a 32-bit: the hash of clients before didit-fp-v2, kept so their records can still be matched.
function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function legacyCompatibilityHash(signals: CollectedSignals): string {
  const components: string[] = [];
  components.push(signals.navigator.userAgent);
  components.push(signals.navigator.platform);
  components.push(signals.navigator.language);
  components.push(signals.navigator.languages.join(","));
  components.push(
    signals.navigator.hardwareConcurrency === null ? "null" : String(signals.navigator.hardwareConcurrency),
  );
  components.push(signals.navigator.deviceMemory === null ? "null" : String(signals.navigator.deviceMemory));
  components.push(signals.navigator.maxTouchPoints === null ? "null" : String(signals.navigator.maxTouchPoints));
  if (signals.navigator.devicePixelRatio !== null) components.push(String(signals.navigator.devicePixelRatio));
  if (signals.navigator.screenWidth !== null && signals.navigator.screenHeight !== null) {
    components.push(`${signals.navigator.screenWidth}x${signals.navigator.screenHeight}`);
    components.push(`${signals.navigator.availWidth}x${signals.navigator.availHeight}`);
    components.push(`${signals.navigator.colorDepth}-${signals.navigator.pixelDepth}`);
    if (signals.navigator.orientation) components.push(signals.navigator.orientation);
  }
  if (signals.navigator.timeZone) components.push(signals.navigator.timeZone);
  if (signals.navigator.connectionEffectiveType !== null) {
    components.push(String(signals.navigator.connectionEffectiveType));
    components.push(
      signals.navigator.connectionDownlink === null ? "null" : String(signals.navigator.connectionDownlink),
    );
  }
  if (signals.navigator.uaDataMobile !== null) {
    components.push(String(signals.navigator.uaDataMobile));
    components.push(String(signals.navigator.uaDataPlatform));
    components.push(signals.navigator.uaDataBrands.join("|"));
  }
  const base = components.join("||");
  if (!base) return "";
  const primary = fnv1a32(base);
  const secondary = fnv1a32(`${base}:${components.length}`);
  return `didit-fp-${primary}${secondary}`;
}

async function composePayload(args: {
  persistent: PersistentIdResult;
  signals: CollectedSignals;
}): Promise<FullDeviceFingerprintPayload> {
  const { persistent, signals } = args;
  const compositeHash = await compositeHashOf(canonicalize(signals));
  const bot: BotDetection = detectBot(signals);
  return {
    version: 2,
    schema: "didit-fp-v2",
    platform: "web",
    collectedAt: new Date().toISOString(),
    persistentId: persistent.id,
    persistentIdSources: persistent.sources,
    persistentIdWasCreated: persistent.wasCreated,
    signals: { platform: "web", tier: "full", compositeHashVersion: COMPOSITE_HASH_VERSION, ...signals },
    bot,
    compositeHash,
    legacyCompatibilityHash: legacyCompatibilityHash(signals),
  };
}

export { canonicalize, type CollectedSignals, composePayload };
