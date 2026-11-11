import { describe, expect, it } from "@jest/globals";
import { collectEnvironmentSignals } from "../signals/environment";
import { type NavigatorSignals } from "../signals/navigator";
import { type WebGLSignals } from "../signals/webgl";

/**
 * An emulator's camera and user agent look like an ordinary handset's from inside the guest.
 * The rendering stack is the tell.
 */

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const EMULATOR_UA =
  "Mozilla/5.0 (Linux; Android 14; sdk_gphone64_arm64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const WINDOWS_DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const LINUX_DESKTOP_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

function navigatorSignals(userAgent: string, uaDataMobile: boolean | null = null): NavigatorSignals {
  return { userAgent, uaDataMobile } as unknown as NavigatorSignals;
}

function webgl(overrides: Partial<WebGLSignals>): WebGLSignals {
  return {
    vendor: null,
    renderer: null,
    unmaskedVendor: null,
    unmaskedRenderer: null,
    blocked: false,
    ...overrides,
  } as unknown as WebGLSignals;
}

describe("emulator / virtual-machine environment signals", () => {
  it("flags the Android emulator by its GLES translator", () => {
    const result = collectEnvironmentSignals(
      webgl({
        unmaskedRenderer: "Android Emulator OpenGL ES Translator (Apple M2 Pro)",
        unmaskedVendor: "Google (Apple)",
      }),
      navigatorSignals(ANDROID_UA),
    );

    expect(result.emulator).toBe(true);
    expect(result.matchedSignatures.length).toBeGreaterThan(0);
  });

  it("flags a software rasterizer on a device claiming to be a phone", () => {
    // No shipping handset renders the web through SwiftShader - this is the exact shape
    // of a host-run Android emulator.
    const result = collectEnvironmentSignals(
      webgl({ unmaskedRenderer: "Google SwiftShader", unmaskedVendor: "Google Inc." }),
      navigatorSignals(ANDROID_UA),
    );

    expect(result.emulator).toBe(true);
  });

  it("does NOT flag a software rasterizer on a desktop", () => {
    // A desktop browser falls back to SwiftShader whenever it blocklists a real GPU.
    // Flagging that would decline genuine users, so the signal stays off.
    const result = collectEnvironmentSignals(
      webgl({ unmaskedRenderer: "Google SwiftShader", unmaskedVendor: "Google Inc." }),
      navigatorSignals(DESKTOP_UA),
    );

    expect(result.emulator).toBe(false);
    expect(result.virtualMachine).toBe(false);
  });

  it("flags a desktop hypervisor as a virtual machine", () => {
    const result = collectEnvironmentSignals(
      webgl({ unmaskedRenderer: "VMware SVGA 3D", unmaskedVendor: "VMware, Inc." }),
      navigatorSignals(DESKTOP_UA),
    );

    expect(result.virtualMachine).toBe(true);
  });

  it("flags a VMware guest through its ANGLE-wrapped and Mesa adapter names", () => {
    // Windows guest under ANGLE, and a Linux guest on the vmwgfx Mesa driver. Both name the
    // virtual adapter itself, which is the only VMware branding that proves a guest.
    for (const renderer of [
      "ANGLE (VMware, VMware SVGA 3D Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "SVGA3D; build: RELEASE; LLVM;",
    ]) {
      const result = collectEnvironmentSignals(
        webgl({ unmaskedRenderer: renderer, unmaskedVendor: "VMware, Inc." }),
        navigatorSignals(DESKTOP_UA),
      );

      expect(result.virtualMachine).toBe(true);
    }
  });

  it("does NOT treat Mesa's VMware vendor branding on llvmpipe as a virtual machine", () => {
    // Mesa reports "VMware, Inc." as the vendor of llvmpipe and softpipe on any physical
    // Linux machine, because VMware wrote them. Only the adapter name proves a guest.
    const result = collectEnvironmentSignals(
      webgl({ unmaskedRenderer: "llvmpipe (LLVM 10.0.0, 256 bits)", unmaskedVendor: "VMware, Inc." }),
      navigatorSignals(LINUX_DESKTOP_UA, false),
    );

    expect(result.emulator).toBe(false);
    expect(result.virtualMachine).toBe(false);
    expect(result.matchedSignatures).toEqual([]);
  });

  it("does NOT treat Windows' WARP software adapter as a virtual machine", () => {
    // "Microsoft Basic Render Driver" is WARP: what a physical PC renders through over
    // Remote Desktop or whenever its display driver is missing or disabled.
    const result = collectEnvironmentSignals(
      webgl({
        unmaskedRenderer:
          "ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)",
        unmaskedVendor: "Google Inc. (Microsoft)",
      }),
      navigatorSignals(WINDOWS_DESKTOP_UA, false),
    );

    expect(result.emulator).toBe(false);
    expect(result.virtualMachine).toBe(false);
    expect(result.matchedSignatures).toEqual([]);
  });

  it("still flags llvmpipe and WARP as an emulator when the user agent claims a phone", () => {
    // The desktop exemptions above must not open a hole: no handset renders through a
    // Direct3D 11 adapter or Mesa's software rasterizer.
    for (const [renderer, vendor] of [
      ["llvmpipe (LLVM 10.0.0, 256 bits)", "VMware, Inc."],
      [
        "ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)",
        "Google Inc. (Microsoft)",
      ],
    ]) {
      const result = collectEnvironmentSignals(
        webgl({ unmaskedRenderer: renderer, unmaskedVendor: vendor }),
        navigatorSignals(ANDROID_UA, true),
      );

      expect(result.emulator).toBe(true);
      expect(result.virtualMachine).toBe(false);
    }
  });

  it("flags an emulator device model carried in the user agent", () => {
    const result = collectEnvironmentSignals(
      webgl({ unmaskedRenderer: "Adreno (TM) 740" }),
      navigatorSignals(EMULATOR_UA),
    );

    expect(result.emulator).toBe(true);
  });

  it("leaves a real handset clean", () => {
    const result = collectEnvironmentSignals(
      webgl({ unmaskedRenderer: "Adreno (TM) 740", unmaskedVendor: "Qualcomm" }),
      navigatorSignals(ANDROID_UA, true),
    );

    expect(result.emulator).toBe(false);
    expect(result.virtualMachine).toBe(false);
    expect(result.matchedSignatures).toEqual([]);
  });

  it("leaves a real desktop clean", () => {
    const result = collectEnvironmentSignals(
      webgl({ unmaskedRenderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)" }),
      navigatorSignals(DESKTOP_UA),
    );

    expect(result.emulator).toBe(false);
    expect(result.virtualMachine).toBe(false);
  });

  it("reports NOT DETERMINED rather than clean when WebGL gives us nothing", () => {
    // Reporting `false` here would let an attacker suppress the signal by denying the probe.
    const result = collectEnvironmentSignals(webgl({ blocked: true }), navigatorSignals(ANDROID_UA));

    expect(result.emulator).toBeNull();
    expect(result.virtualMachine).toBeNull();
  });

  it("reports NOT DETERMINED when WebGL answers only with the browser's placeholder strings", () => {
    // Firefox under fingerprint resistance (or without the debug extension) creates a
    // context but names vendor and renderer "Mozilla"; Chrome and Safari answer "WebKit" /
    // "WebKit WebGL" for the masked pair. Those strings describe no hardware, so an emulator
    // hiding behind them must come out as unavailable, not as explicitly clean.
    for (const [vendor, renderer] of [
      ["Mozilla", "Mozilla"],
      ["WebKit", "WebKit WebGL"],
    ]) {
      const result = collectEnvironmentSignals(webgl({ vendor, renderer }), navigatorSignals(ANDROID_UA, true));

      expect(result.emulator).toBeNull();
      expect(result.virtualMachine).toBeNull();
      expect(result.matchedSignatures).toEqual([]);
    }
  });

  it("keeps positive matches when the rest of the stack is masked", () => {
    // Masking only withholds a clean verdict; it never suppresses a detection that another
    // string still carries.
    const fromUserAgent = collectEnvironmentSignals(
      webgl({ vendor: "Mozilla", renderer: "Mozilla" }),
      navigatorSignals(EMULATOR_UA),
    );
    expect(fromUserAgent.emulator).toBe(true);
    expect(fromUserAgent.virtualMachine).toBeNull();

    const fromUnmaskedRenderer = collectEnvironmentSignals(
      webgl({ vendor: "WebKit", renderer: "WebKit WebGL", unmaskedRenderer: "VMware SVGA 3D" }),
      navigatorSignals(DESKTOP_UA),
    );
    expect(fromUnmaskedRenderer.virtualMachine).toBe(true);
    expect(fromUnmaskedRenderer.emulator).toBe(false);
  });

  it("still judges a stack whose vendor is masked but whose renderer names hardware", () => {
    // Chrome's masked pair sits next to a real unmasked renderer on every ordinary page
    // load; that stack is determined and a real handset stays explicitly clean.
    const result = collectEnvironmentSignals(
      webgl({
        vendor: "WebKit",
        renderer: "WebKit WebGL",
        unmaskedRenderer: "Adreno (TM) 740",
        unmaskedVendor: "Qualcomm",
      }),
      navigatorSignals(ANDROID_UA, true),
    );

    expect(result.emulator).toBe(false);
    expect(result.virtualMachine).toBe(false);
  });
});
