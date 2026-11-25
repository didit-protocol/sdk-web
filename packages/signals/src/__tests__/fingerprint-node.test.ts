/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { setCollectorLoaderForTesting } from "../collector";
import { getDeviceFingerprintPayload, getSignalsEvidence, resetDeviceFingerprintForTesting } from "../fingerprint";

describe("the device fingerprint (non-browser environment)", () => {
  const loader = jest.fn(() => Promise.reject(new Error("must not load")));

  beforeEach(() => {
    loader.mockClear();
    setCollectorLoaderForTesting(loader);
    resetDeviceFingerprintForTesting();
  });

  it("degrades to null instead of collecting junk signals, and loads nothing", async () => {
    await expect(getDeviceFingerprintPayload()).resolves.toBeNull();
    await expect(getSignalsEvidence()).resolves.toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });
});
