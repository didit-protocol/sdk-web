import { describe, expect, it } from "@jest/globals";
import { payloadToHeaders } from "../headers";
import { collectHardwareSignals } from "../signals/hardware";
import { collectMathSignals } from "../signals/math";
import { type DeviceFingerprintPayload } from "../types";

/**
 * API contract guard.
 *
 * The Didit API reads these header names and signal keys by name. If one is renamed or removed
 * here, the API silently stops reading that signal: device identification degrades with no error.
 * This test fails instead. A deliberate change to the contract changes both sides together.
 */

const API_HEADER_NAMES = [
  "X-Didit-FP-V2",
  "X-Didit-PID",
  "X-Didit-FP-Hash",
  "X-Didit-FP-Legacy",
  "X-Didit-FP-Webview",
  "X-Didit-FP-Bot-Score",
];

const API_MATH_KEYS = [
  "tan_1e300",
  "sin_1e300",
  "cos_1e300",
  "atan2_1_2",
  "acosh_big",
  "asinh_big",
  "expm1_1",
  "log_big",
  "exp_1",
];

const API_HARDWARE_KEYS = ["batteryLevelQuantized", "mediaDevicesKinds", "speechSynthesisVoices", "storageQuota"];

describe("device fingerprint API contract", () => {
  it("emits exactly the header names the API reads", () => {
    const payload = {
      persistentId: "pid-1",
      compositeHash: "composite-1",
      legacyCompatibilityHash: "didit-fp-abc",
      signals: { webview: { kind: "whatsapp" } },
      bot: { score: 0.5, flags: [] },
    } as unknown as DeviceFingerprintPayload;

    const headers = payloadToHeaders(payload);
    expect(Object.keys(headers).sort()).toEqual([...API_HEADER_NAMES].sort());
    expect(headers["X-Didit-PID"]).toBe("pid-1");
    expect(headers["X-Didit-FP-Hash"]).toBe("composite-1");
    expect(headers["X-Didit-FP-Bot-Score"]).toBe("0.50");
  });

  it("omits optional headers when their source is absent", () => {
    const minimal = {
      persistentId: "pid-1",
      compositeHash: "",
      legacyCompatibilityHash: "",
      signals: { webview: {} },
      bot: { score: 0, flags: [] },
    } as unknown as DeviceFingerprintPayload;
    const headers = payloadToHeaders(minimal);
    expect(headers).toHaveProperty("X-Didit-FP-V2");
    expect(headers).toHaveProperty("X-Didit-PID");
    expect(headers).not.toHaveProperty("X-Didit-FP-Hash");
    expect(headers).not.toHaveProperty("X-Didit-FP-Webview");
    expect(headers).not.toHaveProperty("X-Didit-FP-Bot-Score");
  });

  it("math signals expose every key the API reads", () => {
    const math = collectMathSignals();
    for (const key of API_MATH_KEYS) {
      expect(math).toHaveProperty(key);
    }
  });

  it("hardware signals expose every key the API reads", async () => {
    const hardware = await collectHardwareSignals();
    for (const key of API_HARDWARE_KEYS) {
      expect(hardware).toHaveProperty(key);
    }
  });
});
