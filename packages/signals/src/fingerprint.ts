import type { DeviceFingerprintPayload, DeviceFingerprintSignals, DeviceFingerprintNavigatorSignals } from "./types";

/**
 * Minimal self-contained port of the didit-fp-v2 device fingerprint used by the
 * Didit verification frontend. It collects stable browser signals, hashes them
 * with WebCrypto SHA-256 and persists a random device id in localStorage with a
 * cookie fallback. The payload shape matches the didit-fp-v2 schema so the Didit
 * backend middleware parses it identically to the verification flow:
 *
 * - headers: X-Didit-PID (persistent id) and X-Didit-FP-Hash (composite hash)
 * - body: a top-level `fingerprint_v2` field carrying the full payload
 */

const PERSISTENT_ID_STORAGE_KEY = "didit-pid-v1";
const PERSISTENT_ID_COOKIE_NAME = "didit_pid";
const PERSISTENT_ID_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 2;
const PERSISTENT_ID_BYTE_LENGTH = 16;

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

interface PersistentIdResult {
  id: string;
  sources: string[];
  wasCreated: boolean;
}

let memoryPersistentId: string | null = null;
let cachedPayload: DeviceFingerprintPayload | null = null;
let cachedPayloadPromise: Promise<DeviceFingerprintPayload> | null = null;

function bytesToBase64Url(bytes: Uint8Array): string {
  let output = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const triplet = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    output += BASE64URL_ALPHABET[(triplet >> 18) & 0x3f];
    output += BASE64URL_ALPHABET[(triplet >> 12) & 0x3f];
    output += BASE64URL_ALPHABET[(triplet >> 6) & 0x3f];
    output += BASE64URL_ALPHABET[triplet & 0x3f];
  }
  if (i < bytes.length) {
    const remaining = bytes.length - i;
    const a = bytes[i];
    const b = remaining > 1 ? bytes[i + 1] : 0;
    const triplet = (a << 16) | (b << 8);
    output += BASE64URL_ALPHABET[(triplet >> 18) & 0x3f];
    output += BASE64URL_ALPHABET[(triplet >> 12) & 0x3f];
    if (remaining > 1) {
      output += BASE64URL_ALPHABET[(triplet >> 6) & 0x3f];
    }
  }
  return output;
}

function randomBytes(length: number): Uint8Array {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const buffer = new Uint8Array(length);
    crypto.getRandomValues(buffer);
    return buffer;
  }
  const fallback = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    fallback[i] = Math.floor(Math.random() * 256);
  }
  return fallback;
}

function randomBase64Url(byteLength: number): string {
  return bytesToBase64Url(randomBytes(byteLength));
}

// SHA-256 truncated to the leading 128 bits, base64url-encoded (22 chars).
// Same construction as the didit-fp-v2 composite hash in the verification frontend.
async function sha256_128(input: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("WebCrypto SubtleCrypto is not available");
  }
  const bytes = new TextEncoder().encode(input);
  const view = new Uint8Array(bytes.byteLength);
  view.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", view.buffer);
  return bytesToBase64Url(new Uint8Array(digest).slice(0, 16));
}

// FNV-1a 32-bit fallback hash, only used when WebCrypto is unavailable.
function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

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

function isValidPersistentId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{20,32}$/.test(value);
}

function readLocalStorageId(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const value = localStorage.getItem(PERSISTENT_ID_STORAGE_KEY);
    return isValidPersistentId(value) ? value : null;
  } catch {
    return null;
  }
}

function writeLocalStorageId(id: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PERSISTENT_ID_STORAGE_KEY, id);
  } catch {
    // Storage may be blocked (private mode, storage policies); cookie layer still applies.
  }
}

function readCookieId(): string | null {
  try {
    if (typeof document === "undefined" || !document.cookie) return null;
    const prefix = `${PERSISTENT_ID_COOKIE_NAME}=`;
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
}

function writeCookieId(id: string): void {
  try {
    if (typeof document === "undefined") return;
    const isSecure = typeof location !== "undefined" && location.protocol === "https:";
    const attributes = [
      `${PERSISTENT_ID_COOKIE_NAME}=${encodeURIComponent(id)}`,
      "Path=/",
      `Max-Age=${PERSISTENT_ID_COOKIE_MAX_AGE_SECONDS}`,
      "SameSite=Lax"
    ];
    if (isSecure) attributes.push("Secure");
    document.cookie = attributes.join("; ");
  } catch {
    // Cookies may be blocked; localStorage layer still applies.
  }
}

function loadOrCreatePersistentId(): PersistentIdResult {
  const fromLocalStorage = readLocalStorageId();
  const fromCookie = readCookieId();

  let id: string;
  let sources: string[];
  let wasCreated = false;

  if (fromLocalStorage) {
    id = fromLocalStorage;
    sources = fromCookie === fromLocalStorage ? ["localStorage", "cookie"] : ["localStorage"];
  } else if (fromCookie) {
    id = fromCookie;
    sources = ["cookie"];
  } else if (memoryPersistentId && isValidPersistentId(memoryPersistentId)) {
    id = memoryPersistentId;
    sources = ["memory"];
  } else {
    id = randomBase64Url(PERSISTENT_ID_BYTE_LENGTH);
    sources = ["fresh"];
    wasCreated = true;
  }

  memoryPersistentId = id;

  // Self-heal any layer that was missing or mismatched.
  if (fromLocalStorage !== id) writeLocalStorageId(id);
  if (fromCookie !== id) writeCookieId(id);

  return { id, sources, wasCreated };
}

function collectNavigatorSignals(): DeviceFingerprintNavigatorSignals {
  const nav = typeof navigator !== "undefined" ? navigator : null;
  const scr = typeof screen !== "undefined" ? screen : null;

  let timeZone: string | null = null;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    timeZone = null;
  }

  const uaData = nav
    ? (nav as Navigator & { userAgentData?: { platform?: string; mobile?: boolean; brands?: { brand: string; version: string }[] } })
        .userAgentData
    : undefined;

  return {
    userAgent: nav?.userAgent ?? "",
    platform: nav?.platform ?? null,
    language: nav?.language ?? "",
    languages: nav?.languages ? [...nav.languages] : [],
    hardwareConcurrency: typeof nav?.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null,
    deviceMemory: (() => {
      const memory = nav ? (nav as Navigator & { deviceMemory?: number }).deviceMemory : undefined;
      return typeof memory === "number" ? memory : null;
    })(),
    maxTouchPoints: typeof nav?.maxTouchPoints === "number" ? nav.maxTouchPoints : null,
    devicePixelRatio: typeof window !== "undefined" && typeof window.devicePixelRatio === "number" ? window.devicePixelRatio : null,
    screenWidth: typeof scr?.width === "number" ? scr.width : null,
    screenHeight: typeof scr?.height === "number" ? scr.height : null,
    colorDepth: typeof scr?.colorDepth === "number" ? scr.colorDepth : null,
    timeZone,
    uaDataPlatform: uaData?.platform ?? null,
    uaDataMobile: typeof uaData?.mobile === "boolean" ? uaData.mobile : null,
    uaDataBrands: uaData?.brands ? uaData.brands.map((entry) => `${entry.brand} ${entry.version}`) : []
  };
}

function detectWebViewKind(userAgent: string): string {
  if (/;\s?wv\)/.test(userAgent) || /\bVersion\/[\d.]+\s+Chrome\/[\d.]+\s+Mobile\b/.test(userAgent)) {
    return "android-webview";
  }
  if (/FBAN|FBAV|Instagram|Line\/|MicroMessenger|Snapchat|musical_ly|BytedanceWebview/i.test(userAgent)) {
    return "in-app-browser";
  }
  if (/iPhone|iPad|iPod/.test(userAgent) && !/Safari\//.test(userAgent) && !/CriOS|FxiOS|EdgiOS/.test(userAgent)) {
    return "ios-webview";
  }
  return "browser";
}

function detectBot(signals: DeviceFingerprintSignals): { score: number; flags: string[] } {
  const flags: string[] = [];
  const userAgent = signals.navigator.userAgent;

  if (typeof navigator !== "undefined" && (navigator as Navigator & { webdriver?: boolean }).webdriver) {
    flags.push("webdriver");
  }
  if (/HeadlessChrome|PhantomJS|Selenium|puppeteer|playwright/i.test(userAgent)) {
    flags.push("headless-ua");
  }
  if (signals.navigator.uaDataMobile === false && /Android|iPhone|iPad/i.test(userAgent)) {
    flags.push("ua-mobile-mismatch");
  }

  return { score: Math.min(1, flags.length / 4), flags };
}

function canonicalizeSignals(signals: DeviceFingerprintSignals): string {
  // Only drift-resistant fields, serialized with stable key order so the same
  // device always produces the same composite hash.
  const stable = {
    platform: signals.platform,
    navigator: {
      ua: signals.navigator.userAgent,
      platform: signals.navigator.platform,
      lang: signals.navigator.language.split("-")[0],
      languages: [...signals.navigator.languages].sort(),
      concurrency: signals.navigator.hardwareConcurrency,
      memory: signals.navigator.deviceMemory,
      maxTouch: signals.navigator.maxTouchPoints,
      dpr: signals.navigator.devicePixelRatio,
      screen: [signals.navigator.screenWidth, signals.navigator.screenHeight],
      colorDepth: signals.navigator.colorDepth,
      timeZone: signals.navigator.timeZone,
      uaDataPlatform: signals.navigator.uaDataPlatform,
      uaDataBrands: signals.navigator.uaDataBrands
    },
    webview: signals.webview.kind
  };
  return stableStringify(stable);
}

async function computeCompositeHash(canonical: string): Promise<string> {
  try {
    return await sha256_128(canonical);
  } catch {
    // Environments without WebCrypto (very old browsers) fall back to a stable FNV-1a pair.
    return `fnv-${fnv1a32(canonical)}${fnv1a32(`${canonical}:fallback`)}`;
  }
}

async function buildPayload(): Promise<DeviceFingerprintPayload> {
  const persistent = loadOrCreatePersistentId();
  const navigatorSignals = collectNavigatorSignals();
  const signals: DeviceFingerprintSignals = {
    platform: "web",
    navigator: navigatorSignals,
    webview: { kind: detectWebViewKind(navigatorSignals.userAgent) }
  };
  const compositeHash = await computeCompositeHash(canonicalizeSignals(signals));

  return {
    version: 2,
    schema: "didit-fp-v2",
    platform: "web",
    collectedAt: new Date().toISOString(),
    persistentId: persistent.id,
    persistentIdSources: persistent.sources,
    persistentIdWasCreated: persistent.wasCreated,
    signals,
    bot: detectBot(signals),
    compositeHash
  };
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
    cachedPayloadPromise = buildPayload().then(
      (payload) => {
        cachedPayload = payload;
        return payload;
      },
      (error) => {
        // Do not cache failures; a later call may succeed.
        cachedPayloadPromise = null;
        throw error;
      }
    );
  }
  return cachedPayloadPromise;
}

export function buildFingerprintHeaders(payload: DeviceFingerprintPayload | null): Record<string, string> {
  if (!payload) return {};
  const headers: Record<string, string> = { "X-Didit-FP-V2": "1" };
  if (payload.persistentId) headers["X-Didit-PID"] = payload.persistentId;
  if (payload.compositeHash) headers["X-Didit-FP-Hash"] = payload.compositeHash;
  if (payload.signals.webview.kind) headers["X-Didit-FP-Webview"] = payload.signals.webview.kind;
  if (payload.bot.score) headers["X-Didit-FP-Bot-Score"] = payload.bot.score.toFixed(2);
  return headers;
}

export function resetDeviceFingerprintForTesting(): void {
  cachedPayload = null;
  cachedPayloadPromise = null;
  memoryPersistentId = null;
}
