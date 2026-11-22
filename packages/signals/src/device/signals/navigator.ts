interface NavigatorSignals {
  userAgent: string;
  userAgentNormalized: string;
  platform: string;
  language: string;
  languages: string[];
  hardwareConcurrency: number | null;
  hardwareConcurrencyQuantized: number | null;
  deviceMemory: number | null;
  maxTouchPoints: number | null;
  devicePixelRatio: number | null;
  screenWidth: number | null;
  screenHeight: number | null;
  availWidth: number | null;
  availHeight: number | null;
  colorDepth: number | null;
  pixelDepth: number | null;
  orientation: string | null;
  timeZone: string;
  connectionEffectiveType: string | null;
  connectionDownlink: number | null;
  uaDataMobile: boolean | null;
  uaDataPlatform: string | null;
  uaDataBrands: string[];
  cookieEnabled: boolean | null;
  doNotTrack: string | null;
}

// Browser features outside the standard DOM typings.
interface NetworkInformationLike {
  effectiveType?: string;
  downlink?: number;
}

interface UserAgentDataLike {
  mobile?: boolean;
  platform?: string;
  brands?: { brand: string; version: string }[];
}

type NavigatorWithHints = Navigator & {
  deviceMemory?: number;
  connection?: NetworkInformationLike;
  mozConnection?: NetworkInformationLike;
  webkitConnection?: NetworkInformationLike;
  userAgentData?: UserAgentDataLike;
};

function safe<T>(read: () => T, fallback: T): T {
  try {
    const value = read();
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

function quantizeConcurrency(value: number | null): number | null {
  if (value === null) return null;
  if (value <= 1) return 1;
  if (value <= 2) return 2;
  if (value <= 4) return 4;
  if (value <= 6) return 6;
  if (value <= 8) return 8;
  if (value <= 12) return 12;
  if (value <= 16) return 16;
  return 20;
}

function normalizeUserAgent(ua: string): string {
  // Collapse fine-grained version numbers (147.0.7727.137 → 147) so two installs of the same major version match.
  return ua.replace(/(\d+)(\.\d+)+/g, "$1");
}

function collectNavigatorSignals(): NavigatorSignals {
  // Outside a browser there is no navigator: every read below then falls back to its empty value.
  const present = typeof navigator !== "undefined";
  const nav = (present ? navigator : {}) as NavigatorWithHints & { doNotTrack?: string };
  const userAgent = safe(() => nav.userAgent || "", "");
  const concurrency = safe(() => nav.hardwareConcurrency ?? null, null);
  const connection = safe(() => nav.connection || nav.mozConnection || nav.webkitConnection || null, null);
  const screenObj = present && typeof screen !== "undefined" ? screen : null;
  const uaData = safe(() => nav.userAgentData, undefined);

  return {
    userAgent,
    userAgentNormalized: normalizeUserAgent(userAgent),
    platform: safe(() => nav.platform || "", ""),
    language: safe(() => nav.language || "", ""),
    languages: safe(() => (nav.languages ? [...nav.languages] : []), []),
    hardwareConcurrency: concurrency,
    hardwareConcurrencyQuantized: quantizeConcurrency(concurrency),
    deviceMemory: safe(() => nav.deviceMemory ?? null, null),
    maxTouchPoints: safe(() => nav.maxTouchPoints ?? null, null),
    devicePixelRatio: safe(() => (present && typeof window !== "undefined" ? (window.devicePixelRatio ?? null) : null), null),
    screenWidth: screenObj?.width ?? null,
    screenHeight: screenObj?.height ?? null,
    availWidth: screenObj?.availWidth ?? null,
    availHeight: screenObj?.availHeight ?? null,
    colorDepth: screenObj?.colorDepth ?? null,
    pixelDepth: screenObj?.pixelDepth ?? null,
    orientation: screenObj && "orientation" in screenObj ? (screenObj.orientation?.type ?? null) : null,
    timeZone: safe(
      () => (present && typeof Intl !== "undefined" && Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone || "" : ""),
      "",
    ),
    connectionEffectiveType: connection?.effectiveType ?? null,
    connectionDownlink: connection?.downlink ?? null,
    uaDataMobile: uaData?.mobile ?? null,
    uaDataPlatform: uaData?.platform ?? null,
    uaDataBrands: uaData?.brands ? uaData.brands.map((b) => `${b.brand}:${b.version}`).sort() : [],
    cookieEnabled: safe(() => nav.cookieEnabled ?? null, null),
    doNotTrack: safe(() => nav.doNotTrack ?? null, null),
  };
}

export { collectNavigatorSignals, type NavigatorSignals };
