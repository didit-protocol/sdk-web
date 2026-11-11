import { sha256_128 } from "./hash";
import { type NavigatorSignals } from "./signals/navigator";

/**
 * Which fields the composite hash reads. It travels inside `signals`, the part of the payload
 * Didit stores, so a stored hash can be told apart from one of an earlier version. A change to
 * `canonicalNavigator` or to the full canonical form changes every device's hash once: raise it.
 */
const COMPOSITE_HASH_VERSION = 3;

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * The user agent without its version numbers: `Chrome/147.0.0.0`, `Version/17.5`,
 * `Build/UP1A.231005.007`, `iPhone OS 17_5_1`, `Android 14`. They change with every browser and
 * system update while the device stays the same; what is left names the browser, the system and,
 * where the browser still gives it, the device model (`SM-S918B`, `2312DRA50G`).
 */
function userAgentWithoutVersions(userAgent: string): string {
  return userAgent
    .replace(/\/[\w.]+/g, "")
    .replace(/\d+(?:[._]\d+)+/g, "")
    .replace(/\bAndroid \d+/g, "Android");
}

/**
 * The browser's brand names without their versions. The placeholder brand Chromium adds
 * ("Not_A Brand", "Not;A=Brand", ...) is left out: its spelling changes from one version to the next.
 */
function brandNames(brands: string[]): string[] {
  return brands
    .map((brand) => brand.split(":")[0])
    .filter((name) => !/not.*brand/i.test(name))
    .sort();
}

/**
 * The navigator part of the canonical form: what describes the device and its browser and reads
 * the same on every visit. No version numbers (a browser update is not another device) and the
 * screen shorter side first (a phone turned on its side is not another device).
 *
 * The light fingerprint hashes this and the webview kind; the full one adds the graphics, font,
 * math and API families (`canonicalize` in compose.ts). Both go through this one function.
 */
function canonicalNavigator(navigator: NavigatorSignals) {
  const screen = [navigator.screenWidth, navigator.screenHeight].sort((a, b) => (a ?? 0) - (b ?? 0));
  return {
    ua: userAgentWithoutVersions(navigator.userAgent),
    platform: navigator.platform,
    lang: navigator.language.split("-")[0],
    languages: [...navigator.languages].sort(),
    concurrency: navigator.hardwareConcurrencyQuantized,
    memory: navigator.deviceMemory,
    maxTouch: navigator.maxTouchPoints,
    dpr: navigator.devicePixelRatio,
    screen,
    colorDepth: navigator.colorDepth,
    timeZone: navigator.timeZone,
    uaDataPlatform: navigator.uaDataPlatform,
    uaDataBrands: brandNames(navigator.uaDataBrands),
  };
}

/**
 * The composite hash of a canonical form: SHA-256, first 128 bits, base64url. Empty where the
 * browser has no WebCrypto (a page served without TLS): the hash is then left out, never replaced
 * by a weaker one that would read as another device.
 */
async function compositeHashOf(canonical: unknown): Promise<string> {
  try {
    return await sha256_128(stableStringify(canonical));
  } catch {
    return "";
  }
}

export { brandNames, canonicalNavigator, COMPOSITE_HASH_VERSION, compositeHashOf, stableStringify, userAgentWithoutVersions };
