/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { getDeviceFingerprintPayload, resetDeviceFingerprintForTesting } from "../fingerprint";

describe("getDeviceFingerprintPayload (non-browser environment)", () => {
  beforeEach(() => {
    resetDeviceFingerprintForTesting();
  });

  it("degrades to null instead of collecting junk signals", async () => {
    await expect(getDeviceFingerprintPayload()).resolves.toBeNull();
  });
});
