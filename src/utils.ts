import { CAMERA_LENSES, CAMERA_QUERY_PARAMS, languages } from "./constants";
import type { CameraLens, DiditSdkConfiguration } from "./types";

class SDKLogger {
  private static _enabled = false;

  static get isEnabled(): boolean {
    return this._enabled;
  }

  static set isEnabled(value: boolean) {
    this._enabled = value;
  }

  static log(...args: unknown[]): void {
    if (this._enabled) {
      console.log("[DiditSDK]", ...args);
    }
  }

  static warn(...args: unknown[]): void {
    if (this._enabled) {
      console.warn("[DiditSDK]", ...args);
    }
  }

  static error(...args: unknown[]): void {
    if (this._enabled) {
      console.error("[DiditSDK]", ...args);
    }
  }
}

export { SDKLogger };

export function generateModalId(): string {
  return `didit-modal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function isAllowedOrigin(origin: string, url: string): boolean {
  try {
    const originURL = new URL(origin);
    const urlURL = new URL(url);
    return originURL.hostname.endsWith(".didit.me") || originURL.hostname === urlURL.hostname;
  } catch {
    return false;
  }
}

export function createVerificationError(
  type: "sessionExpired" | "networkError" | "cameraAccessDenied" | "unknown",
  customMessage?: string
): { type: typeof type; message: string } {
  const messages = {
    sessionExpired: "Your verification session has expired.",
    networkError: "A network error occurred. Please try again.",
    cameraAccessDenied: "Camera access is required for verification.",
    unknown: customMessage || "An unknown error occurred."
  };

  return {
    type,
    message: customMessage || messages[type]
  };
}

function isCameraLens(value: unknown): value is CameraLens {
  return (CAMERA_LENSES as readonly unknown[]).includes(value);
}

const CAMERA_LENS_OPTIONS = ["defaultDocumentCamera", "defaultLivenessCamera"] as const;
const CAMERA_SWITCH_OPTIONS = ["showDocumentCameraSwitchButton", "showLivenessCameraSwitchButton"] as const;

/**
 * The URL the verification iframe loads: the integrator's URL with the
 * configuration options the hosted page reads from its query string.
 *
 * The camera options (the same four the native SDKs expose) become query
 * parameters: `defaultDocumentCamera` -> `document_camera=<lens>`,
 * `defaultLivenessCamera` -> `liveness_camera=<lens>`,
 * `showDocumentCameraSwitchButton` -> `document_camera_switch=true|false`,
 * `showLivenessCameraSwitchButton` -> `liveness_camera_switch=true|false`.
 * Each parameter is set (not appended) so the configuration wins over a value
 * already on the URL; existing query parameters and the hash are kept. A
 * value of the wrong shape is ignored with a warning rather than forwarded,
 * and a URL the browser cannot parse is returned as it came (the modal
 * reports it when it loads).
 */
export function buildVerificationUrl(url: string, configuration?: DiditSdkConfiguration): string {
  if (!configuration) return url;
  const params: Array<[string, string]> = [];
  for (const option of CAMERA_LENS_OPTIONS) {
    const value = configuration[option];
    if (value === undefined) continue;
    if (!isCameraLens(value)) {
      SDKLogger.warn(`Ignoring ${option}: expected "front" or "back", got`, value);
      continue;
    }
    params.push([CAMERA_QUERY_PARAMS[option], value]);
  }
  for (const option of CAMERA_SWITCH_OPTIONS) {
    const value = configuration[option];
    if (value === undefined) continue;
    if (typeof value !== "boolean") {
      SDKLogger.warn(`Ignoring ${option}: expected a boolean, got`, value);
      continue;
    }
    params.push([CAMERA_QUERY_PARAMS[option], value ? "true" : "false"]);
  }
  if (params.length === 0) return url;
  try {
    const parsed = new URL(url);
    params.forEach(([name, value]) => parsed.searchParams.set(name, value));
    return parsed.toString();
  } catch {
    return url;
  }
}

export function detectLanguageFromUrl(url: string): string {
  try {
    const { pathname } = new URL(url);
    const firstSegment = pathname.split("/").filter(Boolean)[0];
    if (firstSegment && languages.includes(firstSegment)) {
      return firstSegment;
    }
  } catch {
    // we get it from the browser
  }

  const browserLang = navigator.language;
  if (languages.includes(browserLang)) return browserLang;
  const baseLang = browserLang.split("-")[0];
  if (languages.includes(baseLang)) return baseLang;

  return "en";
}
