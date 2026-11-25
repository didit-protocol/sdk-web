import { describe, expect, it } from "@jest/globals";
import { payloadToHeaders } from "../headers";
import { type DeviceFingerprintPayload } from "../types";

/**
 * API contract guard.
 *
 * The Didit API reads these header names by name. If one is renamed or removed here, the API
 * silently stops reading it: device identification degrades with no error. This test fails
 * instead. A deliberate change to the contract changes both sides together.
 */
const API_HEADER_NAMES = ["X-Didit-FP-V2", "X-Didit-PID", "X-Didit-FP-Hash", "X-Didit-FP-Legacy", "X-Didit-FP-Webview"];

function makePayload(overrides: Partial<DeviceFingerprintPayload> = {}): DeviceFingerprintPayload {
  return {
    version: 2,
    schema: "didit-fp-v2",
    platform: "web",
    collectedAt: "2026-05-14T00:00:00.000Z",
    persistentId: "pid-test",
    persistentIdSources: ["localStorage"],
    persistentIdWasCreated: false,
    signals: { webview: { kind: "whatsapp" } },
    compositeHash: "composite-test",
    legacyCompatibilityHash: "didit-fp-1234567890abcdef",
    ...overrides,
  } as unknown as DeviceFingerprintPayload;
}

describe("device headers", () => {
  it("emits exactly the header names the API reads, and no score", () => {
    const headers = payloadToHeaders(makePayload({ evidence: '{"v":2}' }));

    expect(Object.keys(headers).sort()).toEqual([...API_HEADER_NAMES].sort());
    expect(headers["X-Didit-FP-V2"]).toBe("1");
    expect(headers["X-Didit-PID"]).toBe("pid-test");
    expect(headers["X-Didit-FP-Hash"]).toBe("composite-test");
    expect(headers["X-Didit-FP-Webview"]).toBe("whatsapp");
  });

  it("keeps the signals and the evidence out of the headers", () => {
    const headers = payloadToHeaders(makePayload({ evidence: '{"v":2}' }));

    expect(JSON.stringify(headers)).not.toContain('{"v":2}');
  });

  it("omits optional headers when their source is absent", () => {
    const headers = payloadToHeaders(
      makePayload({ compositeHash: "", legacyCompatibilityHash: "", signals: { webview: {} } as never }),
    );

    expect(Object.keys(headers).sort()).toEqual(["X-Didit-FP-V2", "X-Didit-PID"]);
  });

  it("returns no headers for a null payload", () => {
    expect(payloadToHeaders(null)).toEqual({});
  });
});
