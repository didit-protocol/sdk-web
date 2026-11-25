import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { installWebCryptoForTests } from "./_test_setup";

installWebCryptoForTests();
import { setCollectorLoaderForTesting } from "../../collector";
import { getDeviceFingerprintPayload, resetDeviceFingerprintForTesting } from "../../fingerprint";
import { canonicalNavigator, compositeHashOf } from "../canonical";
import { detectWebViewContext, webViewKindForVersion4Hash } from "../signals/webview";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const SAFARI_IOS = `${IPHONE} Version/17.5 Mobile/15E148 Safari/604.1`;
const CHROME_IOS = `${IPHONE} CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1`;
const BARE_IOS_WEB_VIEW = `${IPHONE} Mobile/15E148`;
const INSTAGRAM_IOS = `${IPHONE} Mobile/15E148 Instagram 330.0.0.0`;
const ANDROID_WEB_VIEW =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.82 Mobile Safari/537.36";
const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

describe("the kind of browser or web view a page runs in", () => {
  it.each([
    ["Safari on an iPhone", SAFARI_IOS, "browser"],
    ["Chrome on an iPhone", CHROME_IOS, "browser"],
    ["Safari on a Mac", SAFARI_MAC, "browser"],
    ["no user agent", "", "browser"],
    ["an iOS web view that names no app", BARE_IOS_WEB_VIEW, "generic-wv"],
    ["an app that names itself on iOS", INSTAGRAM_IOS, "instagram"],
    ["an Android web view", ANDROID_WEB_VIEW, "generic-wv"],
  ])("%s is %s", (_name, userAgent, kind) => {
    expect(detectWebViewContext(userAgent).kind).toBe(kind);
  });

  it("an iOS web view that names no app is not a standalone browser", () => {
    expect(detectWebViewContext(BARE_IOS_WEB_VIEW)).toEqual({
      kind: "generic-wv",
      hostAppVersion: null,
      isStandaloneBrowser: false,
    });
  });
});

describe("the web view kind in the composite hash", () => {
  it("is the kind the hash always used: an iOS web view that names no app is still hashed as a browser", () => {
    expect(webViewKindForVersion4Hash(BARE_IOS_WEB_VIEW)).toBe("browser");
  });

  it.each([
    ["an Android web view", ANDROID_WEB_VIEW, "generic-wv"],
    ["an app that names itself", INSTAGRAM_IOS, "instagram"],
    ["a browser", SAFARI_IOS, "browser"],
  ])("is the reported kind for %s", (_name, userAgent, kind) => {
    expect(webViewKindForVersion4Hash(userAgent)).toBe(kind);
    expect(detectWebViewContext(userAgent).kind).toBe(kind);
  });
});

describe("the lite payload of an iOS web view that names no app", () => {
  beforeEach(() => {
    setCollectorLoaderForTesting(() => Promise.reject(new Error("no collector")));
    resetDeviceFingerprintForTesting();
    localStorage.clear();
    Object.defineProperty(navigator, "userAgent", { configurable: true, get: () => BARE_IOS_WEB_VIEW });
  });

  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>).userAgent;
    setCollectorLoaderForTesting(null);
    resetDeviceFingerprintForTesting();
  });

  it("says it is a web view, and keeps the hash it had while it was reported as a browser", async () => {
    const payload = await getDeviceFingerprintPayload();
    const hashAsBrowser = await compositeHashOf({
      navigator: canonicalNavigator(payload!.signals.navigator),
      webview: "browser",
    });

    expect(payload!.signals.webview.kind).toBe("generic-wv");
    expect(payload!.compositeHash).toHaveLength(22);
    // A boolean, never the values: a failure must not print a fingerprint.
    expect(payload!.compositeHash === hashAsBrowser).toBe(true);
  });
});
