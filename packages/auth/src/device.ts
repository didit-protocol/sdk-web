// The only module that touches @didit-protocol/signals. Auth requests carry the
// device headers that say which device a request comes from (persistent device
// id, fingerprint hash and webview kind), so every sign-in event is tied to the
// device that made it, and the device evidence the signals package collects,
// which Didit's servers read to decide whether a sign-in is automated.
import { buildFingerprintHeaders, getDeviceFingerprintPayload, getSignalsEvidence } from "@didit-protocol/signals";

export type DeviceSignalsOption = "auto" | "always" | "off";

/** The header that carries the device evidence. */
export const SIGNALS_HEADER = "X-Didit-Signals";

/**
 * The device headers the Authentication API permits from an application's allowed origins (its
 * Access-Control-Allow-Headers), beside the evidence header. A header outside that list makes the
 * browser refuse the whole request across origins, so nothing else the signals package builds is
 * forwarded, now or when it learns to build more.
 */
const PERMITTED_HEADERS = ["X-Didit-FP-V2", "X-Didit-PID", "X-Didit-FP-Hash", "X-Didit-FP-Webview"];

// What a header value may hold, and the most the API reads. Anything else is left out: a value
// `fetch` refuses would fail the request it was only meant to accompany.
const HEADER_SAFE = /^[\x20-\x7e]{1,1024}$/;

type DevicePayload = Awaited<ReturnType<typeof getDeviceFingerprintPayload>>;

/** Where the two parts of the device headers come from. Tests pass their own. */
export interface DeviceReaders {
  /** Which device this is. Answers at once and is the same on every request of the page. */
  payload: () => Promise<DevicePayload>;
  /** The evidence text, or null. With `wait` it may take a moment to arrive; without, never. */
  evidence: (wait: boolean) => Promise<string | null>;
}

const readers: DeviceReaders = {
  // The small fingerprint the signals package builds itself: it never waits for the collector, and
  // its hash does not change once the collector has loaded, so a device keeps one fingerprint.
  payload: () => getDeviceFingerprintPayload({ tier: "lite" }),
  evidence: (wait) => getSignalsEvidence({ wait }),
};

/**
 * Whether a request waits for the device evidence. A step of a sign-in does, for at most the two
 * seconds the signals package waits for its collector: the evidence is what tells Didit's servers
 * whether that step is automated. Reading the session, signing out and exchanging or refreshing
 * tokens never wait: they run when a page loads, and carry the evidence only once it is there.
 * The first request of a page starts the collector, so it has usually finished by the time a
 * person submits a step.
 */
export function waitsForEvidence(method: string, path: string): boolean {
  return method === "POST" && path !== "token/";
}

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
export async function deviceHeaders(waitForEvidence: boolean, from: DeviceReaders = readers): Promise<Record<string, string>> {
  const [payload, evidence] = await Promise.allSettled([from.payload(), from.evidence(waitForEvidence)]);
  const headers: Record<string, string> = {};
  try {
    const built: Record<string, string> = payload.status === "fulfilled" ? buildFingerprintHeaders(payload.value) : {};
    for (const name of PERMITTED_HEADERS) {
      if (typeof built[name] === "string" && built[name]) headers[name] = built[name];
    }
  } catch {
    // A payload the headers cannot be built from sends none of them.
  }
  if (evidence.status === "fulfilled" && typeof evidence.value === "string" && HEADER_SAFE.test(evidence.value)) {
    headers[SIGNALS_HEADER] = evidence.value;
  }
  return headers;
}
