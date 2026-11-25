import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { installWebCryptoForTests } from "../device/__tests__/_test_setup";

// The test browser has no WebCrypto; without it the lite payload has no composite hash.
installWebCryptoForTests();
import { setCollectorLoaderForTesting } from "../collector";
import {
  COLLECTOR_WAIT_MS,
  configureDevice,
  getAvailableDeviceFingerprintPayload,
  getDeviceFingerprintPayload,
  getSignalsEvidence,
  resetDeviceFingerprintForTesting,
  waitingCountForTesting,
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

    fake.collect.mockImplementation(async (options) => fullPayload(options));
    expect((await getDeviceFingerprintPayload())?.signals.tier).toBe("full");
    expect(fake.collect).toHaveBeenCalledTimes(2);
  });
});

const STORED_ID = "SSSSSSSSSSSSSSSSSSSSSS";
const KEPT_ID = "KKKKKKKKKKKKKKKKKKKKKK";
const EMBEDDER_ID = "EEEEEEEEEEEEEEEEEEEEEE";
const STORAGE_KEY = "didit-pid-v1";

/** What a payload says about the device's id. */
const identity = (payload: Awaited<ReturnType<typeof getDeviceFingerprintPayload>>) =>
  payload && [payload.persistentId, payload.persistentIdSources, payload.persistentIdWasCreated];
/** Whether two payloads carry one hash, and there is one: a boolean, so a failure prints no fingerprint. */
const sameHash = (
  one: Awaited<ReturnType<typeof getDeviceFingerprintPayload>>,
  other: Awaited<ReturnType<typeof getDeviceFingerprintPayload>>,
) => Boolean(one?.compositeHash) && one?.compositeHash === other?.compositeHash;
/** A hash that never comes: WebCrypto accepts the digest and does not answer. */
function hashNeverAnswers(): () => void {
  const digest = jest.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(() => new Promise(() => undefined));
  return () => digest.mockRestore();
}

describe("getDeviceFingerprintPayload({ tier: \"lite\" })", () => {
  it("answers with the lite payload and its hash, and never loads the collector", async () => {
    const fake = fakeCollector();
    const load = jest.fn(async () => fake.collector);
    setCollectorLoaderForTesting(load);

    const payload = await getDeviceFingerprintPayload({ tier: "lite" });

    expect(payload?.signals.tier).toBe("lite");
    expect(payload?.persistentId).toBe(localStorage.getItem(STORAGE_KEY));
    expect(payload?.compositeHash.length).toBe(22);
    expect(load).not.toHaveBeenCalled();
    expect(fake.collect).not.toHaveBeenCalled();
  });

  it("waits for its hash for two seconds at most", async () => {
    jest.useFakeTimers();
    const restore = hashNeverAnswers();
    try {
      let settled = false;
      const pending = getDeviceFingerprintPayload({ tier: "lite" }).then((payload) => {
        settled = true;
        return payload;
      });
      await jest.advanceTimersByTimeAsync(COLLECTOR_WAIT_MS - 1);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);

      expect((await pending)?.compositeHash === "").toBe(true);
    } finally {
      restore();
    }
  });

  it("with wait: false answers at once, without a hash that is not there yet, and carries it once it is", async () => {
    jest.useFakeTimers();
    const fake = fakeCollector();
    const load = jest.fn(async () => fake.collector);
    setCollectorLoaderForTesting(load);

    // No timer is advanced: the answer did not wait for anything.
    const first = await getDeviceFingerprintPayload({ tier: "lite", wait: false });
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(50);
    const later = await getDeviceFingerprintPayload({ tier: "lite", wait: false });

    expect(first?.signals.tier).toBe("lite");
    expect(first?.persistentId).toBe(localStorage.getItem(STORAGE_KEY));
    expect(later?.compositeHash.length).toBe(22);
    expect(load).not.toHaveBeenCalled();
  });

  it("with wait: false and a hash that never comes, still answers at once", async () => {
    jest.useFakeTimers();
    const restore = hashNeverAnswers();
    try {
      const payload = await getDeviceFingerprintPayload({ tier: "lite", wait: false });

      expect(payload?.compositeHash === "").toBe(true);
      expect(payload?.persistentId).toBe(localStorage.getItem(STORAGE_KEY));
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      restore();
    }
  });

  it("stays the lite payload, with the same id and hash, after the collector has collected", async () => {
    await getDeviceFingerprintPayload({ tier: "lite" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const before = await getDeviceFingerprintPayload({ tier: "lite" });
    const fake = fakeCollector();
    setCollectorLoaderForTesting(async () => fake.collector);
    const full = getDeviceFingerprintPayload();
    await flushPromises();
    fake.settle();
    expect((await full)?.signals.tier).toBe("full");

    const after = await getDeviceFingerprintPayload({ tier: "lite" });

    expect(after?.signals.tier).toBe("lite");
    expect(after?.persistentId === before?.persistentId).toBe(true);
    expect(sameHash(after, before)).toBe(true);
    expect(after).not.toHaveProperty("evidence");
  });
});

describe("getDeviceFingerprintPayload({ wait: false })", () => {
  it("answers at once with the lite payload, starts the collector, and gives its payload once it has finished", async () => {
    jest.useFakeTimers();
    const fake = fakeCollector();
    setCollectorLoaderForTesting(async () => fake.collector);

    // No timer is advanced: the answer did not wait for the collector.
    const first = await getDeviceFingerprintPayload({ wait: false });
    await flushPromises();
    expect(first?.signals.tier).toBe("lite");
    expect(fake.collect).toHaveBeenCalledTimes(1);

    fake.settle();
    await flushPromises();

    expect((await getDeviceFingerprintPayload({ wait: false }))?.signals.tier).toBe("full");
    expect(fake.collect).toHaveBeenCalledTimes(1);
  });
});

describe("the device id, by default: the page's two stores", () => {
  it("stores the id it makes up at once, and tells the collector which id that is and to keep to those stores", async () => {
    const fake = fakeCollector();
    setCollectorLoaderForTesting(async () => fake.collector);

    const lite = await getDeviceFingerprintPayload({ tier: "lite" });
    void getDeviceFingerprintPayload();
    await flushPromises();

    expect(lite?.persistentIdWasCreated).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(lite?.persistentId);
    expect(document.cookie).toContain(`didit_pid=${lite?.persistentId}`);
    expect(fake.collect).toHaveBeenCalledWith({
      embedderPersistentId: null,
      newPersistentId: lite?.persistentId,
      durableId: false,
    });
  });

  it("does not pass an id it read from a store as one it made up, and gives the cookie the id it lacked", async () => {
    localStorage.setItem(STORAGE_KEY, STORED_ID);
    const fake = fakeCollector();
    setCollectorLoaderForTesting(async () => fake.collector);

    void getDeviceFingerprintPayload();
    await flushPromises();

    expect(fake.collect).toHaveBeenCalledWith({ embedderPersistentId: null, newPersistentId: null, durableId: false });
    expect(document.cookie).toContain(`didit_pid=${STORED_ID}`);
  });

  it("reports a new device as created in both payloads, under one id", async () => {
    const fake = fakeCollector();
    setCollectorLoaderForTesting(async () => fake.collector);

    const pending = getDeviceFingerprintPayload();
    await flushPromises();
    fake.settle();
    const full = await pending;
    const lite = await getDeviceFingerprintPayload({ tier: "lite" });

    expect(full?.persistentIdWasCreated).toBe(true);
    expect(lite?.persistentIdWasCreated).toBe(true);
    expect(lite?.persistentId).toBe(full?.persistentId);
    expect(lite?.persistentId).toBe(localStorage.getItem(STORAGE_KEY));
  });

  it("names one device where storage is blocked: the collector is told the id kept in memory", async () => {
    const blocked = (): never => {
      throw new Error("blocked");
    };
    const getItem = jest.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    const cookie = jest.spyOn(document, "cookie", "set").mockImplementation(blocked);
    try {
      const fake = fakeCollector();
      setCollectorLoaderForTesting(async () => fake.collector);

      const pending = getDeviceFingerprintPayload();
      await flushPromises();
      fake.settle();
      const full = await pending;
      const lite = await getDeviceFingerprintPayload({ tier: "lite" });

      expect(lite?.persistentId).toMatch(/^[A-Za-z0-9_-]{20,32}$/);
      expect(full?.persistentId).toBe(lite?.persistentId);
      expect(fake.collect).toHaveBeenCalledWith({
        embedderPersistentId: null,
        newPersistentId: lite?.persistentId,
        durableId: false,
      });
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
      cookie.mockRestore();
    }
  });
});

describe("the device id with the durable copies on: configureDevice({ durableDeviceId: true })", () => {
  beforeEach(() => configureDevice({ durableDeviceId: true }));

  it("stores nothing before the collector has read every store, and tells the collector the id it made up", async () => {
    const fake = fakeCollector();
    setCollectorLoaderForTesting(async () => fake.collector);

    const lite = await getDeviceFingerprintPayload({ tier: "lite" });
    void getDeviceFingerprintPayload();
    await flushPromises();

    expect(lite?.persistentIdWasCreated).toBe(true);
    // A copy written now would vote against an id a slower store still holds, on this page or after a reload.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(document.cookie).not.toContain("didit_pid");
    expect(fake.collect).toHaveBeenCalledWith({
      embedderPersistentId: null,
      newPersistentId: lite?.persistentId,
      durableId: true,
    });
  });

  it("does not repair one of its two stores from the other either: the collector settles them", async () => {
    document.cookie = `didit_pid=${STORED_ID}; Path=/`;

    const lite = await getDeviceFingerprintPayload({ tier: "lite" });

    expect(identity(lite)).toEqual([STORED_ID, ["cookie"], false]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("hands out the id the collector settled the stores on: the one a slower store still kept", async () => {
    const fake = fakeCollector();
    setCollectorLoaderForTesting(async () => fake.collector);

    const before = await getDeviceFingerprintPayload({ tier: "lite" });
    const pending = getDeviceFingerprintPayload();
    await flushPromises();
    // What the collector does when it finds the id the device had: it writes it to the page's
    // stores, and answers with it.
    localStorage.setItem(STORAGE_KEY, KEPT_ID);
    fake.settle({ persistentId: KEPT_ID, persistentIdSources: ["cache"], persistentIdWasCreated: false });
    const full = await pending;
    const after = await getDeviceFingerprintPayload({ tier: "lite" });

    expect(before?.persistentId).not.toBe(KEPT_ID);
    expect(identity(full)).toEqual([KEPT_ID, ["cache"], false]);
    expect(after?.signals.tier).toBe("lite");
    expect(identity(after)).toEqual([KEPT_ID, ["localStorage"], false]);
    expect(identity(getAvailableDeviceFingerprintPayload())).toEqual([KEPT_ID, ["cache"], false]);
  });

  it("hands out an id the stores get later, after the collector had already answered", async () => {
    const fake = fakeCollector();
    setCollectorLoaderForTesting(async () => fake.collector);

    const pending = getDeviceFingerprintPayload();
    await flushPromises();
    fake.settle();
    const atOnce = await pending;
    expect(atOnce?.persistentIdWasCreated).toBe(true);
    // A store that answered after the collector had returned held the id the device had: the
    // collector settles the page's stores on it.
    localStorage.setItem(STORAGE_KEY, KEPT_ID);

    const full = await getDeviceFingerprintPayload();
    const lite = await getDeviceFingerprintPayload({ tier: "lite" });

    expect(full?.signals.tier).toBe("full");
    expect(identity(full)).toEqual([KEPT_ID, ["localStorage"], false]);
    expect(identity(lite)).toEqual([KEPT_ID, ["localStorage"], false]);
    expect(identity(getAvailableDeviceFingerprintPayload())).toEqual([KEPT_ID, ["localStorage"], false]);
  });

  it("stores the id itself where there is no collector to do it", async () => {
    setCollectorLoaderForTesting(() => Promise.reject(new Error("blocked")));

    const payload = await getDeviceFingerprintPayload();

    expect(payload?.signals.tier).toBe("lite");
    expect(localStorage.getItem(STORAGE_KEY)).toBe(payload?.persistentId);
    expect(document.cookie).toContain(`didit_pid=${payload?.persistentId}`);
  });

  it("stores the id itself when the collection fails", async () => {
    const fake = fakeCollector();
    fake.collect.mockRejectedValue(new Error("boom"));
    setCollectorLoaderForTesting(async () => fake.collector);

    const payload = await getDeviceFingerprintPayload();

    expect(localStorage.getItem(STORAGE_KEY)).toBe(payload?.persistentId);
  });
});

describe("the two seconds a request waits", () => {
  it("ends for the lite payload too: with neither the collector nor the hash, the request goes out without a hash", async () => {
    jest.useFakeTimers();
    const restore = hashNeverAnswers();
    try {
      const fake = fakeCollector();
      setCollectorLoaderForTesting(async () => fake.collector);

      let settled = false;
      const pending = getDeviceFingerprintPayload().then((payload) => {
        settled = true;
        return payload;
      });
      await jest.advanceTimersByTimeAsync(COLLECTOR_WAIT_MS - 1);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      const payload = await pending;

      expect(payload?.signals.tier).toBe("lite");
      expect(payload?.compositeHash === "").toBe(true);
      expect(payload?.persistentId).toBe(localStorage.getItem(STORAGE_KEY));
    } finally {
      restore();
    }
  });

  it("is not spent on the hash when the collector cannot be loaded: the lite payload answers with its hash", async () => {
    jest.useFakeTimers();
    setCollectorLoaderForTesting(() => Promise.reject(new Error("blocked")));

    const pending = getDeviceFingerprintPayload();
    // No timer is advanced past the hash: the request did not wait for the two seconds.
    await jest.advanceTimersByTimeAsync(50);
    const payload = await pending;

    expect(payload?.signals.tier).toBe("lite");
    expect(payload?.compositeHash.length).toBe(22);
  });

  it("leaves nothing behind for a request whose time ran out, however many there were, and one collection serves them all", async () => {
    jest.useFakeTimers();
    const fake = fakeCollector();
    setCollectorLoaderForTesting(async () => fake.collector);

    const requests = Array.from({ length: 200 }, () => getDeviceFingerprintPayload());
    await flushPromises();
    expect(waitingCountForTesting()).toBe(200);
    await jest.advanceTimersByTimeAsync(COLLECTOR_WAIT_MS);
    const payloads = await Promise.all(requests);

    expect(payloads.every((payload) => payload?.signals.tier === "lite")).toBe(true);
    // The collection is still under way, and no request is still attached to it.
    expect(waitingCountForTesting()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    expect(fake.collect).toHaveBeenCalledTimes(1);
  });
});

describe("configureDevice({ embedderDeviceId }): a page inside another site's frame", () => {
  it("goes by the embedding page's id while its own storage has none, and writes it nowhere", async () => {
    const fake = fakeCollector();
    setCollectorLoaderForTesting(async () => fake.collector);
    configureDevice({ embedderDeviceId: EMBEDDER_ID });

    const lite = await getDeviceFingerprintPayload({ tier: "lite" });
    void getDeviceFingerprintPayload();
    await flushPromises();

    expect(identity(lite)).toEqual([EMBEDDER_ID, ["embedder"], false]);
    expect(lite?.signals.embedder).toEqual({ persistentId: EMBEDDER_ID });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(document.cookie).not.toContain("didit_pid");
    // The collector is handed the embedding page's id, and no made-up one: none was made up.
    expect(fake.collect).toHaveBeenCalledWith({
      embedderPersistentId: EMBEDDER_ID,
      newPersistentId: null,
      durableId: false,
    });
  });

  it("is not stored when there is no collector either", async () => {
    setCollectorLoaderForTesting(() => Promise.reject(new Error("no collector")));
    configureDevice({ embedderDeviceId: EMBEDDER_ID });

    const payload = await getDeviceFingerprintPayload();

    expect(payload?.persistentId).toBe(EMBEDDER_ID);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("keeps the id the page already stores, and still says which page embeds it", async () => {
    localStorage.setItem(STORAGE_KEY, STORED_ID);
    setCollectorLoaderForTesting(() => Promise.reject(new Error("no collector")));
    configureDevice({ embedderDeviceId: EMBEDDER_ID });

    const lite = await getDeviceFingerprintPayload();

    expect(lite?.persistentId).toBe(STORED_ID);
    expect(lite?.signals.embedder).toEqual({ persistentId: EMBEDDER_ID });
  });

  it("keeps the other setting it was given before", async () => {
    const fake = fakeCollector();
    setCollectorLoaderForTesting(async () => fake.collector);
    configureDevice({ durableDeviceId: true });
    configureDevice({ embedderDeviceId: EMBEDDER_ID });

    void getDeviceFingerprintPayload();
    await flushPromises();

    expect(fake.collect).toHaveBeenCalledWith({
      embedderPersistentId: EMBEDDER_ID,
      newPersistentId: null,
      durableId: true,
    });
  });

  it.each([["a script"], ["<script>alert(1)</script>"], [""], ["short"], [null]])(
    "ignores %j, which is not a device id",
    async (passed) => {
      const fake = fakeCollector();
      setCollectorLoaderForTesting(async () => fake.collector);
      configureDevice({ embedderDeviceId: passed });

      const lite = await getDeviceFingerprintPayload({ tier: "lite" });
      void getDeviceFingerprintPayload();
      await flushPromises();

      expect(lite?.persistentIdWasCreated).toBe(true);
      expect(lite?.signals).not.toHaveProperty("embedder");
      expect(fake.collect).toHaveBeenCalledWith({
        embedderPersistentId: null,
        newPersistentId: lite?.persistentId,
        durableId: false,
      });
    },
  );
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
    expect(getAvailableDeviceFingerprintPayload()?.compositeHash === "").toBe(true);

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

  it("with wait: false answers at once with null, starts the collector, and has the evidence once it finished", async () => {
    jest.useFakeTimers();
    const fake = fakeCollector();
    setCollectorLoaderForTesting(async () => fake.collector);

    // No timer is advanced: an answer here did not wait for anything.
    await expect(getSignalsEvidence({ wait: false })).resolves.toBeNull();
    await flushPromises();
    expect(fake.collect).toHaveBeenCalledTimes(1);
    // Still collecting: still null, and the collection is not started twice.
    await expect(getSignalsEvidence({ wait: false })).resolves.toBeNull();
    await flushPromises();
    expect(fake.collect).toHaveBeenCalledTimes(1);

    fake.settle();
    await flushPromises();

    await expect(getSignalsEvidence({ wait: false })).resolves.toBe(FAKE_EVIDENCE);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("with wait: false never rejects when the load fails or evidence() throws", async () => {
    setCollectorLoaderForTesting(() => Promise.reject(new Error("blocked")));
    await expect(getSignalsEvidence({ wait: false })).resolves.toBeNull();
    await flushPromises();
    await expect(getSignalsEvidence({ wait: false })).resolves.toBeNull();

    resetDeviceFingerprintForTesting();
    const broken = fakeCollector();
    broken.collector.evidence = () => {
      throw new Error("boom");
    };
    setCollectorLoaderForTesting(async () => broken.collector);
    await getSignalsEvidence({ wait: false });
    await flushPromises();
    broken.settle();
    await flushPromises();
    await expect(getSignalsEvidence({ wait: false })).resolves.toBeNull();
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
