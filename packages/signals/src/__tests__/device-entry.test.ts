import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { installWebCryptoForTests } from "../device/__tests__/_test_setup";

installWebCryptoForTests();

import { resetFingerprintCacheForTesting, enableDeviceIntelligence } from "../device";
import { buildFingerprintHeaders, getDeviceFingerprintPayload, resetDeviceFingerprintForTesting } from "../fingerprint";

describe("@didit-protocol/signals/device", () => {
  beforeEach(() => {
    resetDeviceFingerprintForTesting();
    resetFingerprintCacheForTesting();
    localStorage.clear();
    document.cookie = "didit_pid=; Path=/; Max-Age=0";
  });

  afterEach(() => {
    resetDeviceFingerprintForTesting();
    resetFingerprintCacheForTesting();
  });

  it("makes the full fingerprint the one the core entry sends", async () => {
    const lite = await getDeviceFingerprintPayload();
    expect(lite!.signals.tier).toBe("lite");

    enableDeviceIntelligence();
    const full = await getDeviceFingerprintPayload();

    expect(full!.signals.tier).toBe("full");
    expect(full!.signals).toHaveProperty("webgl");
    expect(full!.signals).toHaveProperty("fonts");
    expect(full!.signals).toHaveProperty("environment");
    // One stored id for the two tiers: they read and write the same storage.
    expect(full!.persistentId).toBe(lite!.persistentId);
    expect(full!.persistentIdWasCreated).toBe(false);
    // The two tiers hash different amounts of the device, so the hashes differ; the headers name both.
    expect(full!.compositeHash).toHaveLength(22);
    expect(full!.compositeHash).not.toBe(lite!.compositeHash);
    const headers = buildFingerprintHeaders(full);
    expect(headers["X-Didit-PID"]).toBe(lite!.persistentId);
    expect(headers["X-Didit-FP-Hash"]).toBe(full!.compositeHash);
    expect(headers["X-Didit-FP-Legacy"]).toMatch(/^didit-fp-[0-9a-f]{16}$/);
  });

  it("collects once, however many requests ask", async () => {
    enableDeviceIntelligence();
    const [first, second] = await Promise.all([getDeviceFingerprintPayload(), getDeviceFingerprintPayload()]);
    expect(second).toBe(first);
    expect(await getDeviceFingerprintPayload()).toBe(first);
  });
});
