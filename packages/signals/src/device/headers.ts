import { type DeviceFingerprintPayload } from "./types";

type HeaderRecord = Record<string, string>;

/**
 * The device headers a Didit API reads. They carry the identifiers only; the signals themselves
 * travel in the request body (`fingerprint_v2`), which has no size limit a proxy would enforce.
 * No header carries a score: Didit's servers decide it from the evidence in the body.
 */
function payloadToHeaders(payload: DeviceFingerprintPayload | null): HeaderRecord {
  if (!payload) return {};
  const headers: HeaderRecord = { "X-Didit-FP-V2": "1" };
  if (payload.persistentId) headers["X-Didit-PID"] = payload.persistentId;
  if (payload.compositeHash) headers["X-Didit-FP-Hash"] = payload.compositeHash;
  if (payload.legacyCompatibilityHash) headers["X-Didit-FP-Legacy"] = payload.legacyCompatibilityHash;
  if (payload.signals?.webview?.kind) headers["X-Didit-FP-Webview"] = payload.signals.webview.kind;
  return headers;
}

export { payloadToHeaders };
