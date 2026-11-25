import { describe, it, expect, beforeEach } from "@jest/globals";
import { installWebCryptoForTests } from "../device/__tests__/_test_setup";

// The test browser has no WebCrypto; without it the composite hash is left out (see the last test).
installWebCryptoForTests();
import { setCollectorLoaderForTesting } from "../collector";
import {
  buildFingerprintHeaders,
  getDeviceFingerprintPayload,
  resetDeviceFingerprintForTesting,
} from "../fingerprint";

describe("getDeviceFingerprintPayload (browser environment)", () => {
  beforeEach(() => {
    // No collector in these tests: they check the lite payload every request can fall back to.
    setCollectorLoaderForTesting(() => Promise.reject(new Error("no collector")));
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
    // Clients send facts; the score is decided on Didit's servers.
    expect(payload).not.toHaveProperty("bot");
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
    expect(headers).not.toHaveProperty("X-Didit-FP-Bot-Score");
  });
});

describe("light fingerprint", () => {
  beforeEach(() => {
    setCollectorLoaderForTesting(() => Promise.reject(new Error("no collector")));
    resetDeviceFingerprintForTesting();
    localStorage.clear();
    document.cookie = "didit_pid=; Path=/; Max-Age=0";
  });

  it("says which signals it carries and which hash version it used", async () => {
    const payload = await getDeviceFingerprintPayload();
    expect(payload!.signals).toMatchObject({ platform: "web", tier: "lite", compositeHashVersion: 4 });
    expect(payload!.signals.webview).toEqual({ kind: "browser", hostAppVersion: null, isStandaloneBrowser: true });
    expect(payload).not.toHaveProperty("legacyCompatibilityHash");
  });

  it("keeps its hash across a browser update and a turned phone", async () => {
    const nav = navigator as unknown as Record<string, unknown>;
    async function hashWith(userAgent: string, width: number, height: number): Promise<string> {
      Object.defineProperty(navigator, "userAgent", { configurable: true, get: () => userAgent });
      Object.defineProperty(screen, "width", { configurable: true, get: () => width });
      Object.defineProperty(screen, "height", { configurable: true, get: () => height });
      resetDeviceFingerprintForTesting();
      try {
        return (await getDeviceFingerprintPayload())!.compositeHash;
      } finally {
        delete nav.userAgent;
        delete (screen as unknown as Record<string, unknown>).width;
        delete (screen as unknown as Record<string, unknown>).height;
      }
    }
    const before = await hashWith(
      "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7727.137 Mobile Safari/537.36",
      412,
      915,
    );
    const after = await hashWith(
      "Mozilla/5.0 (Linux; Android 15; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7801.12 Mobile Safari/537.36",
      915,
      412,
    );
    const otherPhone = await hashWith(
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7727.137 Mobile Safari/537.36",
      412,
      915,
    );
    expect(before).toHaveLength(22);
    expect(after).toBe(before);
    expect(otherPhone).not.toBe(before);
  });

  it("sends the stored id without a hash where the browser has no WebCrypto", async () => {
    const subtle = Object.getOwnPropertyDescriptor(globalThis.crypto, "subtle");
    Object.defineProperty(globalThis.crypto, "subtle", { configurable: true, value: undefined });
    try {
      const payload = await getDeviceFingerprintPayload();
      const headers = buildFingerprintHeaders(payload);
      expect(payload!.compositeHash).toBe("");
      expect(headers["X-Didit-PID"]).toBe(payload!.persistentId);
      expect(headers).not.toHaveProperty("X-Didit-FP-Hash");
    } finally {
      if (subtle) Object.defineProperty(globalThis.crypto, "subtle", subtle);
      else delete (globalThis.crypto as { subtle?: unknown }).subtle;
    }
  });
});
