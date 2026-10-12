import { describe, it, expect, beforeEach } from "@jest/globals";
import { buildFingerprintHeaders, getDeviceFingerprintPayload, resetDeviceFingerprintForTesting } from "../fingerprint";

describe("getDeviceFingerprintPayload (browser environment)", () => {
  beforeEach(() => {
    resetDeviceFingerprintForTesting();
    localStorage.clear();
    document.cookie = "didit_pid=; Path=/; Max-Age=0";
  });

  it("builds a didit-fp-v2 payload with a persistent id and composite hash", async () => {
    const payload = await getDeviceFingerprintPayload();

    expect(payload).not.toBeNull();
    expect(payload!.version).toBe(2);
    expect(payload!.schema).toBe("didit-fp-v2");
    expect(payload!.platform).toBe("web");
    expect(payload!.persistentId).toMatch(/^[A-Za-z0-9_-]{20,32}$/);
    expect(payload!.persistentIdWasCreated).toBe(true);
    expect(payload!.compositeHash).toBeTruthy();
    expect(payload!.signals.platform).toBe("web");
    expect(typeof payload!.signals.navigator.userAgent).toBe("string");
    expect(payload!.bot.score).toBeGreaterThanOrEqual(0);
    expect(payload!.bot.score).toBeLessThanOrEqual(1);
  });

  it("persists the id in localStorage and reuses it on subsequent collections", async () => {
    const first = await getDeviceFingerprintPayload();
    expect(localStorage.getItem("didit-pid-v1")).toBe(first!.persistentId);

    resetDeviceFingerprintForTesting();
    const second = await getDeviceFingerprintPayload();
    expect(second!.persistentId).toBe(first!.persistentId);
    expect(second!.persistentIdWasCreated).toBe(false);
    expect(second!.persistentIdSources).toContain("localStorage");
  });
});

describe("buildFingerprintHeaders", () => {
  it("returns no headers for a null payload", () => {
    expect(buildFingerprintHeaders(null)).toEqual({});
  });

  it("builds the didit-fp-v2 header set from a payload", async () => {
    resetDeviceFingerprintForTesting();
    const payload = await getDeviceFingerprintPayload();
    const headers = buildFingerprintHeaders(payload);

    expect(headers["X-Didit-FP-V2"]).toBe("1");
    expect(headers["X-Didit-PID"]).toBe(payload!.persistentId);
    expect(headers["X-Didit-FP-Hash"]).toBe(payload!.compositeHash);
    expect(headers["X-Didit-FP-Webview"]).toBe(payload!.signals.webview.kind);
    // jsdom reports jsdom in the UA; no bot flags fire, so the score header is omitted.
    if (payload!.bot.score) {
      expect(headers["X-Didit-FP-Bot-Score"]).toBe(payload!.bot.score.toFixed(2));
    } else {
      expect(headers).not.toHaveProperty("X-Didit-FP-Bot-Score");
    }
  });
});
