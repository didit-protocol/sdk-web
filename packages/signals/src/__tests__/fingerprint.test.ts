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
  const scope = window as unknown as Record<string, unknown>;
  const nav = navigator as unknown as Record<string, unknown>;

  async function bot() {
    resetDeviceFingerprintForTesting();
    return (await getDeviceFingerprintPayload())!.bot;
  }

  function withProperty<T>(target: object, name: string, value: unknown, run: () => Promise<T>): Promise<T> {
    Object.defineProperty(target, name, { configurable: true, get: () => value });
    return run().finally(() => {
      delete (target as Record<string, unknown>)[name];
    });
  }

  afterEach(() => {
    resetDeviceFingerprintForTesting();
    document.documentElement.removeAttribute("webdriver");
  });

  it("is zero, with no flags, in a browser nothing is driving", async () => {
    expect(await bot()).toEqual({ score: 0, flags: [] });
    expect(buildFingerprintHeaders(await getDeviceFingerprintPayload())).not.toHaveProperty("X-Didit-FP-Bot-Score");
  });

  it("reaches the 0.8 the Authentication API treats as a bot on navigator.webdriver alone", async () => {
    const result = await withProperty(nav, "webdriver", true, bot);

    expect(result).toEqual({ score: 0.9, flags: ["webdriver"] });
  });

  it("ignores a webdriver property that is not true", async () => {
    expect(await withProperty(nav, "webdriver", false, bot)).toEqual({ score: 0, flags: [] });
  });

  it.each([
    ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36"],
    ["Mozilla/5.0 (Unknown; Linux x86_64) AppleWebKit/538.1 (KHTML, like Gecko) PhantomJS/2.1.1 Safari/538.1"],
    ["Mozilla/5.0 Playwright/1.56"]
  ])("scores a headless or automation user agent 0.9: %s", async (userAgent) => {
    expect(await withProperty(nav, "userAgent", userAgent, bot)).toEqual({ score: 0.9, flags: ["headless-ua"] });
  });

  it("reads the headless brand from the client hints when the user agent string was replaced", async () => {
    const userAgentData = { platform: "macOS", mobile: false, brands: [{ brand: "HeadlessChrome", version: "141" }] };

    expect(await withProperty(nav, "userAgentData", userAgentData, bot)).toEqual({ score: 0.9, flags: ["headless-ua"] });
  });

  it.each([["__playwright__binding__"], ["__puppeteer_evaluation_script__"], ["callPhantom"], ["__selenium_unwrapped"]])(
    "scores a global left by an automation driver 1: %s",
    async (name) => {
      expect(await withProperty(scope, name, () => undefined, bot)).toEqual({ score: 1, flags: ["automation-artifact"] });
    }
  );

  it("scores chromedriver's document key and a webdriver attribute on the root element 1", async () => {
    // chromedriver assigns its state to the document as a plain property.
    const page = document as unknown as Record<string, unknown>;
    page["$cdc_asdjflasutopfhvcZLmcfl_"] = {};
    try {
      expect(await bot()).toEqual({ score: 1, flags: ["automation-artifact"] });
    } finally {
      delete page["$cdc_asdjflasutopfhvcZLmcfl_"];
    }
    expect(await bot()).toEqual({ score: 0, flags: [] });

    document.documentElement.setAttribute("webdriver", "true");
    expect(await bot()).toEqual({ score: 1, flags: ["automation-artifact"] });
  });

  it("keeps a desktop client hint with a mobile user agent below the threshold on its own", async () => {
    const userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    const userAgentData = { platform: "macOS", mobile: false, brands: [] };

    const result = await withProperty(nav, "userAgent", userAgent, () => withProperty(nav, "userAgentData", userAgentData, bot));

    expect(result).toEqual({ score: 0.3, flags: ["ua-mobile-mismatch"] });
  });

  it("takes the strongest flag, and lists every flag found", async () => {
    const result = await withProperty(nav, "webdriver", true, () => withProperty(scope, "__pwInitScripts", {}, bot));

    expect(result).toEqual({ score: 1, flags: ["automation-artifact", "webdriver"] });
    expect(buildFingerprintHeaders(await getDeviceFingerprintPayload())).not.toHaveProperty("X-Didit-FP-Bot-Score", "0.00");
  });
});
