import { describe, expect, it } from "@jest/globals";
import { type FullDeviceFingerprintPayload } from "../types";

type FingerprintPayload = FullDeviceFingerprintPayload;
import { attachFingerprintPayload, payloadToHeaders } from "../headers";

function makePayload(): FingerprintPayload {
  return {
    version: 2,
    schema: "didit-fp-v2",
    collectedAt: "2026-05-14T00:00:00.000Z",
    persistentId: "pid-test",
    persistentIdSources: ["idb"],
    persistentIdWasCreated: false,
    signals: {
      webview: { kind: "browser", hostAppVersion: null, isStandaloneBrowser: true },
    },
    bot: { score: 0.25, flags: ["webdriver"] },
    compositeHash: "composite-test",
    legacyCompatibilityHash: "didit-fp-1234567890abcdef",
  } as FingerprintPayload;
}

describe("fingerprint transport helpers", () => {
  it("keeps rich signals out of headers", () => {
    const headers = payloadToHeaders(makePayload());
    expect(headers["X-Didit-FP-V2"]).toBe("1");
    expect(headers["X-Didit-PID"]).toBe("pid-test");
    expect(headers["X-Didit-FP-Signals"]).toBeUndefined();
  });

  it("adds fingerprint_v2 to JSON-like payloads", () => {
    const enriched = attachFingerprintPayload({ locale: "en" }, makePayload()) as Record<string, unknown>;
    expect(enriched.locale).toBe("en");
    expect(enriched.fingerprint_v2).toMatchObject({
      schema: "didit-fp-v2",
      persistentId: "pid-test",
    });
  });

  it("adds fingerprint_v2 to multipart payloads", () => {
    const formData = new FormData();
    formData.append("locale", "en");

    const enriched = attachFingerprintPayload(formData, makePayload()) as FormData;
    const rawFingerprint = enriched.get("fingerprint_v2");

    expect(rawFingerprint).toEqual(expect.any(String));
    expect(JSON.parse(rawFingerprint as string)).toMatchObject({
      schema: "didit-fp-v2",
      persistentId: "pid-test",
    });
  });
});
