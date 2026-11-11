// The only module that touches @didit-protocol/signals. Auth requests carry the
// same device headers as the verification flow (persistent device id,
// fingerprint hash, webview kind and bot score), so every sign-in event is
// tied to the device that made it.
import { buildFingerprintHeaders, getDeviceFingerprintPayload } from "@didit-protocol/signals";

export type DeviceSignalsOption = "auto" | "always" | "off";

/**
 * Whether auth requests carry device headers: in a browser, unless they are turned off.
 * They go to the application's own Didit origin, which lists them in
 * Access-Control-Allow-Headers for the application's allowed origins, so they cross
 * origins the way the Authorization header does. "always" is kept for callers that set
 * it while "auto" still meant same-origin only; the two now behave the same.
 */
export function deviceSignalsEnabled(option: DeviceSignalsOption): boolean {
  return option !== "off" && typeof window !== "undefined";
}

export async function deviceHeaders(): Promise<Record<string, string>> {
  try {
    return buildFingerprintHeaders(await getDeviceFingerprintPayload());
  } catch {
    // Device signals never block a sign-in.
    return {};
  }
}
