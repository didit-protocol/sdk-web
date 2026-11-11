import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { installWebCryptoForTests } from "../device/__tests__/_test_setup";

// The test browser has no WebCrypto; without it the composite hash is left out (see the last test).
installWebCryptoForTests();
import {
  buildFingerprintHeaders,
  getDeviceFingerprintPayload,
  resetDeviceFingerprintForTesting,
  setDeviceSignalsProvider,
} from "../fingerprint";

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

describe("light fingerprint", () => {
  beforeEach(() => {
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

describe("full fingerprint as the source", () => {
  afterEach(() => {
    resetDeviceFingerprintForTesting();
  });

  it("sends what the provider collects, and falls back to a new collection after a failure", async () => {
    const full = { persistentId: "pid-from-the-full-collector", signals: { tier: "full" } } as never;
    let attempts = 0;
    setDeviceSignalsProvider({
      get: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("collection failed");
        return full;
      },
      peek: () => (attempts > 1 ? full : null),
    });

    await expect(getDeviceFingerprintPayload()).rejects.toThrow("collection failed");
    expect(await getDeviceFingerprintPayload()).toBe(full);
    expect(await getDeviceFingerprintPayload()).toBe(full);
    expect(attempts).toBe(2);
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
