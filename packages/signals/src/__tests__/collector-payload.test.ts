import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { installWebCryptoForTests } from "../device/__tests__/_test_setup";

// The test browser has no WebCrypto; without it the lite payload has no composite hash.
installWebCryptoForTests();
import { setCollectorLoaderForTesting } from "../collector";
import {
  COLLECTOR_WAIT_MS,
  getAvailableDeviceFingerprintPayload,
  getDeviceFingerprintPayload,
  getSignalsEvidence,
  resetDeviceFingerprintForTesting,
} from "../fingerprint";
import { FAKE_EVIDENCE, fakeCollector, fullPayload } from "./fake-collector";

/** Lets promise jobs run without moving fake timers. */
async function flushPromises(): Promise<void> {
  for (let round = 0; round < 20; round++) await Promise.resolve();
}

beforeEach(() => {
  localStorage.clear();
  document.cookie = "didit_pid=; Path=/; Max-Age=0";
  resetDeviceFingerprintForTesting();
});

afterEach(() => {
  jest.useRealTimers();
  setCollectorLoaderForTesting(null);
  resetDeviceFingerprintForTesting();
});

describe("getDeviceFingerprintPayload with the collector", () => {
  it("returns the collector's payload when it arrives in time", async () => {
    const fake = fakeCollector();
    setCollectorLoaderForTesting(async () => fake.collector);

    const pending = getDeviceFingerprintPayload();
    await flushPromises();
    fake.settle();
    const payload = await pending;

    expect(payload?.signals.tier).toBe("full");
    expect(payload?.evidence).toBe(FAKE_EVIDENCE);
    expect(payload).not.toHaveProperty("bot");
  });

  it("creates the stored id before the collector starts, and both payloads carry it", async () => {
    jest.useFakeTimers();
    const fake = fakeCollector();
    setCollectorLoaderForTesting(async () => fake.collector);

    const pending = getDeviceFingerprintPayload();
    await flushPromises();
    expect(fake.collect).toHaveBeenCalledTimes(1);
    expect(fake.storedIdWhenCollecting[0]).toMatch(/^[A-Za-z0-9_-]{20,32}$/);

    jest.advanceTimersByTime(COLLECTOR_WAIT_MS);
    const lite = await pending;
    fake.settle();
    await flushPromises();
    const full = await getDeviceFingerprintPayload();

    expect(lite?.signals.tier).toBe("lite");
    expect(full?.signals.tier).toBe("full");
    expect(full?.persistentId).toBe(lite?.persistentId);
    expect(fake.storedIdWhenCollecting[0]).toBe(lite?.persistentId);
  });

  it("goes out with the lite payload after the bound, and uses the collector's once it arrived", async () => {
    jest.useFakeTimers();
    const fake = fakeCollector();
    setCollectorLoaderForTesting(async () => fake.collector);

    let settled = false;
    const pending = getDeviceFingerprintPayload().then((payload) => {
      settled = true;
      return payload;
    });
    await flushPromises();
    jest.advanceTimersByTime(COLLECTOR_WAIT_MS - 1);
    await flushPromises();
    expect(settled).toBe(false);

    jest.advanceTimersByTime(1);
    const lite = await pending;
    expect(lite?.signals.tier).toBe("lite");
    expect(lite).not.toHaveProperty("evidence");
    expect(lite).not.toHaveProperty("bot");

    fake.settle();
    await flushPromises();
    expect((await getDeviceFingerprintPayload())?.evidence).toBe(FAKE_EVIDENCE);
    // One collection, however many requests asked.
    expect(fake.collect).toHaveBeenCalledTimes(1);
  });

  it("returns the lite payload when the collector cannot be loaded, and does not load it again", async () => {
    const loader = jest.fn(() => Promise.reject(new Error("blocked")));
    setCollectorLoaderForTesting(loader);

    expect((await getDeviceFingerprintPayload())?.signals.tier).toBe("lite");
    expect((await getDeviceFingerprintPayload())?.signals.tier).toBe("lite");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["rejects", (collect: ReturnType<typeof fakeCollector>["collect"]) => collect.mockRejectedValue(new Error("boom"))],
    [
      "throws",
      (collect: ReturnType<typeof fakeCollector>["collect"]) =>
        collect.mockImplementation(() => {
          throw new Error("boom");
        }),
    ],
  ])("returns the lite payload when collect() %s, and tries again on the next call", async (_name, fail) => {
    const fake = fakeCollector();
    fail(fake.collect);
    setCollectorLoaderForTesting(async () => fake.collector);

    expect((await getDeviceFingerprintPayload())?.signals.tier).toBe("lite");

    fake.collect.mockImplementation(async () => fullPayload());
    expect((await getDeviceFingerprintPayload())?.signals.tier).toBe("full");
    expect(fake.collect).toHaveBeenCalledTimes(2);
  });
});

describe("getAvailableDeviceFingerprintPayload", () => {
  it("never waits and never starts a load", async () => {
    const loader = jest.fn(() => Promise.reject(new Error("must not load")));
    setCollectorLoaderForTesting(loader);

    expect(getAvailableDeviceFingerprintPayload()).toBeNull();
    await flushPromises();
    expect(loader).not.toHaveBeenCalled();
  });

  it("gives the pending lite payload, then the lite one, then the collector's", async () => {
    jest.useFakeTimers();
    const fake = fakeCollector();
    setCollectorLoaderForTesting(async () => fake.collector);

    const pending = getDeviceFingerprintPayload();
    // The lite payload exists before its hash does.
    expect(getAvailableDeviceFingerprintPayload()?.signals.tier).toBe("lite");
    expect(getAvailableDeviceFingerprintPayload()?.compositeHash).toBe("");

    await flushPromises();
    jest.advanceTimersByTime(COLLECTOR_WAIT_MS);
    const lite = await pending;
    expect(getAvailableDeviceFingerprintPayload()).toBe(lite);

    fake.settle();
    await flushPromises();
    expect(getAvailableDeviceFingerprintPayload()?.signals.tier).toBe("full");
  });
});

describe("getSignalsEvidence", () => {
  it("gives the evidence text when the collector arrives in time", async () => {
    const fake = fakeCollector();
    setCollectorLoaderForTesting(async () => fake.collector);

    const pending = getSignalsEvidence();
    await flushPromises();
    fake.settle();

    await expect(pending).resolves.toBe(FAKE_EVIDENCE);
  });

  it("gives null on timeout", async () => {
    jest.useFakeTimers();
    const fake = fakeCollector();
    setCollectorLoaderForTesting(async () => fake.collector);

    const pending = getSignalsEvidence();
    await flushPromises();
    jest.advanceTimersByTime(COLLECTOR_WAIT_MS);

    await expect(pending).resolves.toBeNull();
  });

  it("gives null, and never rejects, when the load fails, collect() fails or evidence() throws", async () => {
    setCollectorLoaderForTesting(() => Promise.reject(new Error("blocked")));
    await expect(getSignalsEvidence()).resolves.toBeNull();

    resetDeviceFingerprintForTesting();
    const failing = fakeCollector();
    failing.collect.mockRejectedValue(new Error("boom"));
    setCollectorLoaderForTesting(async () => failing.collector);
    await expect(getSignalsEvidence()).resolves.toBeNull();

    resetDeviceFingerprintForTesting();
    const broken = fakeCollector();
    broken.collector.evidence = () => {
      throw new Error("boom");
    };
    setCollectorLoaderForTesting(async () => broken.collector);
    const pending = getSignalsEvidence();
    await flushPromises();
    broken.settle();
    await expect(pending).resolves.toBeNull();
  });
});
