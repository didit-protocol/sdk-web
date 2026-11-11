import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
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

describe("bot score", () => {
  const nav = navigator as unknown as Record<string, unknown>;

  async function bot() {
    resetDeviceFingerprintForTesting();
    return (await getDeviceFingerprintPayload())!.bot;
  }

  function withProperty<T>(name: string, value: unknown, run: () => Promise<T>): Promise<T> {
    Object.defineProperty(navigator, name, { configurable: true, get: () => value });
    return run().finally(() => {
      delete nav[name];
    });
  }

  afterEach(() => {
    resetDeviceFingerprintForTesting();
  });

  it("is zero, with no flags, in a browser nothing is driving", async () => {
    expect(await bot()).toEqual({ score: 0, flags: [] });
    expect(buildFingerprintHeaders(await getDeviceFingerprintPayload())).not.toHaveProperty("X-Didit-FP-Bot-Score");
  });

  it("reaches the 0.8 the Authentication API treats as a bot on navigator.webdriver alone", async () => {
    expect(await withProperty("webdriver", true, bot)).toEqual({ score: 0.9, flags: ["webdriver"] });
    expect(buildFingerprintHeaders(await withProperty("webdriver", true, async () => {
      resetDeviceFingerprintForTesting();
      return getDeviceFingerprintPayload();
    }))["X-Didit-FP-Bot-Score"]).toBe("0.90");
  });

  it("ignores a webdriver property that is false", async () => {
    expect(await withProperty("webdriver", false, bot)).toEqual({ score: 0, flags: [] });
  });

  it.each([
    ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36"],
    ["Mozilla/5.0 (Unknown; Linux x86_64) AppleWebKit/538.1 (KHTML, like Gecko) PhantomJS/2.1.1 Safari/538.1"],
    ["Mozilla/5.0 Playwright/1.56"]
  ])("scores a headless or automation user agent 0.9: %s", async (userAgent) => {
    expect(await withProperty("userAgent", userAgent, bot)).toEqual({ score: 0.9, flags: ["headless-ua"] });
  });

  it("keeps a desktop client hint with a mobile user agent below the threshold on its own", async () => {
    const userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    const userAgentData = { platform: "macOS", mobile: false, brands: [] };

    const result = await withProperty("userAgent", userAgent, () => withProperty("userAgentData", userAgentData, bot));

    expect(result).toEqual({ score: 0.3, flags: ["ua-mobile-mismatch"] });
  });

  it("takes the strongest flag, in any order, and lists every flag found", async () => {
    const mobile = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Mobile Safari/537.36";
    const userAgentData = { platform: "Linux", mobile: false, brands: [] };

    const result = await withProperty("webdriver", true, () =>
      withProperty("userAgent", mobile, () => withProperty("userAgentData", userAgentData, bot))
    );

    expect(result).toEqual({ score: 0.9, flags: ["webdriver", "headless-ua", "ua-mobile-mismatch"] });
  });
});
