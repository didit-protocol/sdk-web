// The only module that touches @didit-protocol/signals. Auth requests carry the
// same device headers as the verification flow (persistent device id,
// fingerprint hash and webview kind), so every sign-in event is
// tied to the device that made it, and the device evidence the signals
// package collects, which Didit's servers read to decide whether a sign-in is
// automated.
import { buildFingerprintHeaders, getDeviceFingerprintPayload, getSignalsEvidence } from "@didit-protocol/signals";

export type DeviceSignalsOption = "auto" | "always" | "off";

/** The header that carries the device evidence. */
export const SIGNALS_HEADER = "X-Didit-Signals";

// What a header value may hold, and the most the API reads. Anything else is left out: a value
// `fetch` refuses would fail the request it was only meant to accompany.
const HEADER_SAFE = /^[\x20-\x7e]{1,1024}$/;

/** Where the two parts of the device headers come from. Tests pass their own. */
export interface DeviceReaders {
  payload: typeof getDeviceFingerprintPayload;
  evidence: typeof getSignalsEvidence;
}

const readers: DeviceReaders = { payload: getDeviceFingerprintPayload, evidence: getSignalsEvidence };

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

/**
 * The device headers of one request. The two parts are read independently, and neither can fail
 * the other or the request: device signals never block a sign-in.
 */
export async function deviceHeaders(from: DeviceReaders = readers): Promise<Record<string, string>> {
  const [payload, evidence] = await Promise.allSettled([from.payload(), from.evidence()]);
  let headers: Record<string, string> = {};
  try {
    if (payload.status === "fulfilled") headers = { ...buildFingerprintHeaders(payload.value) };
  } catch {
    // A payload the headers cannot be built from sends none of them.
  }
  if (evidence.status === "fulfilled" && typeof evidence.value === "string" && HEADER_SAFE.test(evidence.value)) {
    headers[SIGNALS_HEADER] = evidence.value;
  }
  return headers;
}
