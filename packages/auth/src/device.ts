// The only module that touches @didit-protocol/signals. Auth requests carry the
// same device headers as the verification flow (persistent device id,
// fingerprint hash, webview kind and bot score), so every sign-in event is
// tied to the device that made it.
import { buildFingerprintHeaders, getDeviceFingerprintPayload } from "@didit-protocol/signals";

export type DeviceSignalsOption = "auto" | "always" | "off";

/**
 * Whether requests to `apiBase` carry device headers. Cross-origin requests
 * only do so with "always": the browser preflights custom headers, and the
 * Didit API must list them in Access-Control-Allow-Headers first.
 */
export function deviceSignalsEnabled(option: DeviceSignalsOption, apiBase: string): boolean {
  if (option === "off" || typeof window === "undefined") return false;
  return option === "always" || new URL(apiBase).origin === window.location.origin;
}

export async function deviceHeaders(): Promise<Record<string, string>> {
  try {
    return buildFingerprintHeaders(await getDeviceFingerprintPayload());
  } catch {
    // Device signals never block a sign-in.
    return {};
  }
}
