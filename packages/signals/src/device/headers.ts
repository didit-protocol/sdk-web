import { type DeviceFingerprintPayload } from "./types";

type HeaderRecord = Record<string, string>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The device headers a Didit API reads. They carry the identifiers only; the signals themselves
 * travel in the request body (`fingerprint_v2`), which has no size limit a proxy would enforce.
 */
function payloadToHeaders(payload: DeviceFingerprintPayload | null): HeaderRecord {
  if (!payload) return {};
  const headers: HeaderRecord = { "X-Didit-FP-V2": "1" };
  if (payload.persistentId) headers["X-Didit-PID"] = payload.persistentId;
  if (payload.compositeHash) headers["X-Didit-FP-Hash"] = payload.compositeHash;
  if (payload.legacyCompatibilityHash) headers["X-Didit-FP-Legacy"] = payload.legacyCompatibilityHash;
  if (payload.signals?.webview?.kind) headers["X-Didit-FP-Webview"] = payload.signals.webview.kind;
  if (payload.bot?.score) headers["X-Didit-FP-Bot-Score"] = payload.bot.score.toFixed(2);
  return headers;
}

/**
 * Add the payload to a request body as `fingerprint_v2`: a JSON string part of a multipart body, a
 * field of a JSON object. A body that already has one, or is neither, is returned as it came.
 */
function attachFingerprintPayload(data: unknown, payload: object | null): unknown {
  if (!payload) return data;

  if (typeof FormData !== "undefined" && data instanceof FormData) {
    if (!data.has("fingerprint_v2")) {
      data.append("fingerprint_v2", JSON.stringify(payload));
    }
    return data;
  }

  if (isPlainRecord(data)) {
    if (!("fingerprint_v2" in data)) {
      return { ...data, fingerprint_v2: payload };
    }
    return data;
  }

  return data;
}

export { attachFingerprintPayload, payloadToHeaders };
