import { describe, expect, it } from "@jest/globals";
import { installWebCryptoForTests } from "./_test_setup";
installWebCryptoForTests();

import { detectBot } from "../bot";
import { brandNames, COMPOSITE_HASH_VERSION } from "../canonical";
import { type CollectedSignals, composePayload } from "../compose";

type FingerprintSignals = CollectedSignals;

function makeSignals(overrides: Partial<FingerprintSignals> = {}): FingerprintSignals {
  const base: FingerprintSignals = {
    navigator: {
      userAgent: "Mozilla/5.0",
      userAgentNormalized: "Mozilla/5",
      platform: "Linux",
      language: "en-US",
      languages: ["en-US", "en"],
      hardwareConcurrency: 8,
      hardwareConcurrencyQuantized: 8,
      deviceMemory: 4,
      maxTouchPoints: 5,
      devicePixelRatio: 2,
      screenWidth: 412,
      screenHeight: 915,
      availWidth: 412,
      availHeight: 891,
      colorDepth: 24,
      pixelDepth: 24,
      orientation: "portrait-primary",
      timeZone: "America/Panama",
      connectionEffectiveType: "4g",
      connectionDownlink: 10,
      uaDataMobile: true,
      uaDataPlatform: "Android",
      uaDataBrands: ["Chrome:147"],
      cookieEnabled: true,
      doNotTrack: null,
    },
    canvas: { pngHash: "canvas-a", chunkSketch: [], blocked: false },
    webgl: {
      vendor: "WebKit",
      renderer: "WebKit WebGL",
      unmaskedVendor: "Qualcomm",
      unmaskedRenderer: "Adreno (TM) 610",
      version: "WebGL 2.0",
      shadingLanguageVersion: "GLSL ES 3.00",
      maxTextureSize: 8192,
      maxViewportDims: [8192, 8192],
      maxRenderbufferSize: 8192,
      aliasedLineWidthRange: [1, 1],
      aliasedPointSizeRange: [1, 1024],
      extensions: ["ANGLE_instanced_arrays"],
      shaderPrecision: { v_hf: "23,127,127", f_hf: "23,127,127" },
      blocked: false,
    },
    audio: { sum: "35.74", blocked: false },
    fonts: { available: ["Arial", "Roboto"], count: 2, blocked: false },
    math: {
      tan_1e300: "-1.5",
      sin_1e300: "0",
      cos_1e300: "1",
      atan2_1_2: "0.4",
      acosh_big: "709.7",
      asinh_big: "0.88",
      expm1_1: "1.71",
      log_big: "354.8",
      exp_1: "2.71",
    },
    apiBitmap: "ffaa",
    apiMissing: [],
    hardware: {
      batteryLevelQuantized: 0.8,
      batteryCharging: true,
      mediaDevicesKinds: { videoinput: 2, audioinput: 1 },
      speechSynthesisVoices: 0,
      storageQuota: 1_000_000,
      storageUsage: 1_000,
    },
    webview: { kind: "whatsapp", hostAppVersion: "2.26.17.72", isStandaloneBrowser: false },
    codecs: {
      media: { 'video/mp4; codecs="avc1.42E01E"': "probably", 'video/webm; codecs="vp9"': "probably" },
      recorder: { "video/webm;codecs=vp9": true },
      blocked: false,
    },
    environment: { emulator: false, virtualMachine: false, matchedSignatures: [] },
  };
  return Object.assign(base, overrides);
}

describe("composePayload", () => {
  it("produces a stable v2 payload with required fields", async () => {
    const payload = await composePayload({
      persistent: { id: "pid-test-aaaaaaaaaaaaaa", sources: ["fresh"], wasCreated: true },
      signals: makeSignals(),
    });
    expect(payload.version).toBe(2);
    expect(payload.schema).toBe("didit-fp-v2");
    expect(payload.persistentId).toBe("pid-test-aaaaaaaaaaaaaa");
    expect(payload.compositeHash).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(payload.legacyCompatibilityHash).toMatch(/^didit-fp-[0-9a-f]{16}$/);
    expect(payload.collectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("is deterministic — same signals produce same composite_hash", async () => {
    const s = makeSignals();
    const a = await composePayload({
      persistent: { id: "x", sources: [], wasCreated: false },
      signals: s,
    });
    const b = await composePayload({
      persistent: { id: "x", sources: [], wasCreated: false },
      signals: s,
    });
    expect(a.compositeHash).toBe(b.compositeHash);
    expect(a.legacyCompatibilityHash).toBe(b.legacyCompatibilityHash);
  });

  it("distinguishes two different WebGL renderers (Honor case)", async () => {
    const honorJDY = makeSignals({
      webgl: { ...makeSignals().webgl, unmaskedRenderer: "Adreno (TM) 610" },
      canvas: { pngHash: "honorJDY", chunkSketch: [], blocked: false },
    });
    const honorGFY = makeSignals({
      webgl: { ...makeSignals().webgl, unmaskedRenderer: "Mali-G57" },
      canvas: { pngHash: "honorGFY", chunkSketch: [], blocked: false },
    });
    const a = await composePayload({
      persistent: { id: "pid-A", sources: [], wasCreated: false },
      signals: honorJDY,
    });
    const b = await composePayload({
      persistent: { id: "pid-B", sources: [], wasCreated: false },
      signals: honorGFY,
    });
    expect(a.compositeHash).not.toBe(b.compositeHash);
  });

  it("emits bot flags when ua claims iPhone but uaData is desktop", () => {
    const signals = makeSignals({
      navigator: {
        ...makeSignals().navigator,
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17)",
        uaDataMobile: false,
      },
    });
    const bot = detectBot(signals);
    expect(bot.flags).toContain("ua-mobile-mismatch");
  });

  it("keeps the same hash for one browser across what changes between its visits", async () => {
    // Each of these used to move the hash. None of them is a different device.
    const first = makeSignals({
      navigator: {
        ...makeSignals().navigator,
        userAgent:
          "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Version/4.0 Chrome/147.0.7727.137 Mobile Safari/537.36",
        userAgentNormalized: "first",
        uaDataBrands: ["Chromium:147", "Google Chrome:147", "Not_A Brand:8"],
      },
    });
    const later = makeSignals({
      navigator: {
        ...first.navigator,
        // A browser and a system update.
        userAgent:
          "Mozilla/5.0 (Linux; Android 15; SM-S918B Build/AP3A.240905.015; wv) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Version/4.0 Chrome/149.0.7801.12 Mobile Safari/537.36",
        userAgentNormalized: "later",
        uaDataBrands: ["Chromium:149", "Google Chrome:149", "Not;A=Brand:24"],
        // The phone turned on its side.
        screenWidth: first.navigator.screenHeight,
        screenHeight: first.navigator.screenWidth,
        orientation: "landscape-primary",
      },
      // The camera permission was granted: real device counts replace one placeholder per kind.
      hardware: { ...first.hardware, mediaDevicesKinds: { videoinput: 4, audioinput: 3, audiooutput: 1 } },
      // The collectors' time budget ran out on a busy page, or a privacy browser added its noise.
      canvas: { pngHash: "", chunkSketch: [], blocked: true },
      audio: { sum: "35.73999999", blocked: false },
    });
    const a = await composePayload({ persistent: { id: "pid-A", sources: [], wasCreated: false }, signals: first });
    const b = await composePayload({ persistent: { id: "pid-A", sources: [], wasCreated: false }, signals: later });
    expect(b.compositeHash).toBe(a.compositeHash);
    // The left-out signals still travel, to be compared one by one.
    expect(b.signals.hardware.mediaDevicesKinds).toEqual({ videoinput: 4, audioinput: 3, audiooutput: 1 });
    expect(b.signals.canvas.blocked).toBe(true);
    expect(b.signals.compositeHashVersion).toBe(COMPOSITE_HASH_VERSION);
  });

  it("keeps the same hash through the Chromium versions whose placeholder brand has a colon in it", async () => {
    // The brand list of Chromium 154 to 157, as each version sends it. Read up to the first colon,
    // 155 left "Not(A" and 156 left "Not" in the list, and three updates in a row changed the hash.
    const brandsByVersion = [
      ["Chromium:154", "Google Chrome:154", "Not A(Brand:99"],
      ["Chromium:155", "Google Chrome:155", "Not(A:Brand:24"],
      ["Chromium:156", "Google Chrome:156", "Not:A-Brand:8"],
      ["Chromium:157", "Google Chrome:157", "Not-A.Brand:99"],
    ];
    const hashes: string[] = [];
    for (const uaDataBrands of brandsByVersion) {
      const signals = makeSignals({ navigator: { ...makeSignals().navigator, uaDataBrands } });
      const payload = await composePayload({ persistent: { id: "pid-A", sources: [], wasCreated: false }, signals });
      hashes.push(payload.compositeHash);
    }
    expect(hashes[0]).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(new Set(hashes).size).toBe(1);
  });

  it.each([
    [
      "device model",
      { userAgent: "Mozilla/5.0 (Linux; Android 14; 2312DRA50G Build/UKQ1.230917.001; wv) Chrome/147.0" },
    ],
    ["browser", { uaDataBrands: ["Chromium:147", "Microsoft Edge:147", "Not_A Brand:8"] }],
    ["language list", { languages: ["es-PA", "es"] }],
    ["time zone", { timeZone: "Europe/Madrid" }],
    ["screen", { screenWidth: 360, screenHeight: 800 }],
    ["pixel ratio", { devicePixelRatio: 3 }],
    ["memory", { deviceMemory: 8 }],
  ])("changes the hash with a different %s", async (_name, change) => {
    const reference = makeSignals({
      navigator: {
        ...makeSignals().navigator,
        userAgent: "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) Chrome/147.0",
        uaDataBrands: ["Chromium:147", "Google Chrome:147", "Not_A Brand:8"],
      },
    });
    const other = makeSignals({ navigator: { ...reference.navigator, ...change } });
    const a = await composePayload({ persistent: { id: "pid-A", sources: [], wasCreated: false }, signals: reference });
    const b = await composePayload({ persistent: { id: "pid-B", sources: [], wasCreated: false }, signals: other });
    expect(b.compositeHash).not.toBe(a.compositeHash);
  });

  it("leaves out Chromium's placeholder brand however it is spelled, and keeps every real one", () => {
    expect(brandNames(["Google Chrome:147", "Not_A Brand:8", "Chromium:147"])).toEqual(["Chromium", "Google Chrome"]);
    expect(brandNames(["NOT)A;BRAND:99", "Not;A=Brand:24", ";Not A Brand:99"])).toEqual([]);
    // Two Chromium versions out of eleven put a colon in it: the version is what follows the last one.
    expect(brandNames(["Not:A-Brand:99", "Chromium:156", "Google Chrome:156"])).toEqual(["Chromium", "Google Chrome"]);
    expect(brandNames(["Chromium:155", "Not(A:Brand:8", "Google Chrome:155"])).toEqual(["Chromium", "Google Chrome"]);
    // "brand" has to come after "not"; a name with only one of the two is a real brand.
    expect(brandNames(["Brand Not:1", "Nothing:1", "Brandy:1"])).toEqual(["Brand Not", "Brandy", "Nothing"]);

    // A name of 600,000 characters is read once: `/not.*brand/` would restart at every "not" in it.
    const long = "not".repeat(200000);
    const started = performance.now();
    expect(brandNames([long])).toEqual([long]);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("keeps the hash while the codec answers or the shader precision differ or go missing", async () => {
    // Collected and kept out of the hash: neither is steady enough on one browser.
    const a = await composePayload({
      persistent: { id: "pid-A", sources: [], wasCreated: false },
      signals: makeSignals(),
    });
    const b = await composePayload({
      persistent: { id: "pid-A", sources: [], wasCreated: false },
      signals: makeSignals({
        codecs: { media: {}, recorder: {}, blocked: true },
        webgl: { ...makeSignals().webgl, shaderPrecision: null },
      }),
    });
    expect(a.compositeHash).toBe(b.compositeHash);
    expect(a.legacyCompatibilityHash).toBe(b.legacyCompatibilityHash);
  });

  it("produces the hash every Didit web client produces for the same signals", async () => {
    // Pinned values: the hosted verification flow sends these exact hashes for these signals. A
    // change here means every known device gets a new hash: raise COMPOSITE_HASH_VERSION with it.
    const payload = await composePayload({
      persistent: { id: "pid-A", sources: [], wasCreated: false },
      signals: makeSignals(),
    });
    expect(payload.compositeHash).toBe("kxNH3FyDkPbsZPHk3rdUSw");
    expect(payload.legacyCompatibilityHash).toBe("didit-fp-054c6c571f474cde");
    expect(payload.signals).toMatchObject({ platform: "web", tier: "full", compositeHashVersion: 4 });
  });

  it("leaves the hash out, and keeps the stored id, where the browser has no WebCrypto", async () => {
    const subtle = Object.getOwnPropertyDescriptor(globalThis.crypto, "subtle");
    Object.defineProperty(globalThis.crypto, "subtle", { configurable: true, value: undefined });
    try {
      const payload = await composePayload({
        persistent: { id: "pid-A", sources: ["localStorage"], wasCreated: false },
        signals: makeSignals(),
      });
      expect(payload.compositeHash).toBe("");
      expect(payload.persistentId).toBe("pid-A");
    } finally {
      if (subtle) Object.defineProperty(globalThis.crypto, "subtle", subtle);
      else delete (globalThis.crypto as { subtle?: unknown }).subtle;
    }
  });

  it("scores the strongest automation flag, not how many fired", () => {
    // A phone's user agent: the test browser has no plugins, which on a desktop is a flag of its own.
    const phone = {
      ...makeSignals().navigator,
      userAgent: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/147.0.0.0 Mobile Safari/537.36",
    };
    expect(detectBot(makeSignals({ navigator: phone }))).toEqual({ score: 0, flags: [] });

    const softwareRenderer = detectBot(
      makeSignals({ navigator: phone, webgl: { ...makeSignals().webgl, unmaskedRenderer: "Google SwiftShader" } }),
    );
    expect(softwareRenderer).toEqual({ score: 0.5, flags: ["software-renderer"] });

    const headless = detectBot(
      makeSignals({
        navigator: { ...phone, userAgent: `${phone.userAgent} HeadlessChrome/147.0.0.0` },
        webgl: { ...makeSignals().webgl, unmaskedRenderer: "Google SwiftShader" },
      }),
    );
    expect(headless).toEqual({ score: 0.9, flags: ["headless-ua", "software-renderer"] });

    // A desktop without plugins, nothing else: a weak flag, far from the 0.8 that counts as automation.
    expect(detectBot(makeSignals())).toEqual({ score: 0.3, flags: ["desktop-no-plugins"] });
  });

  it("flags software renderers as bot signal", () => {
    const signals = makeSignals({
      webgl: { ...makeSignals().webgl, unmaskedRenderer: "Google SwiftShader" },
    });
    const bot = detectBot(signals);
    expect(bot.flags).toContain("software-renderer");
  });
});
