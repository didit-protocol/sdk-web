import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { installWebCryptoForTests } from "../device/__tests__/_test_setup";

// The test browser has no WebCrypto; without it the lite payload has no composite hash.
installWebCryptoForTests();
import { type DeviceCollector, setCollectorLoaderForTesting } from "../collector";
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

type Payload = Awaited<ReturnType<typeof getDeviceFingerprintPayload>>;

const STORED_ID = "SSSSSSSSSSSSSSSSSSSSSS";
const OTHER_ID = "OOOOOOOOOOOOOOOOOOOOOO";
const EMBEDDER_ID = "EEEEEEEEEEEEEEEEEEEEEE";
const STORAGE_KEY = "didit-pid-v1";

/** Lets promise jobs run without moving fake timers. */
async function flushPromises(): Promise<void> {
  for (let round = 0; round < 20; round++) await Promise.resolve();
}

/** What a payload says about the device's id. */
const identity = (payload: Payload) =>
  payload && [payload.persistentId, payload.persistentIdSources, payload.persistentIdWasCreated];
/** Whether two payloads carry one hash, and there is one: a boolean, so a failure prints no fingerprint. */
const sameHash = (one: Payload, other: Payload) =>
  Boolean(one?.compositeHash) && one?.compositeHash === other?.compositeHash;
/** A hash that never comes: WebCrypto accepts the digest and does not answer. */
function hashNeverAnswers(): () => void {
  const digest = jest.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(() => new Promise(() => undefined));
  return () => digest.mockRestore();
}
/** A collector that is there at once. */
function collectorLoaded() {
  const fake = fakeCollector();
  const load = jest.fn(async () => fake.collector);
  setCollectorLoaderForTesting(load);
  return { ...fake, load };
}
/** A collector whose file arrives only when the test says so. */
function collectorLoading() {
  const fake = fakeCollector();
  let arrive: () => void = () => undefined;
  const file = new Promise<DeviceCollector>((resolve) => {
    arrive = () => resolve(fake.collector);
  });
  const load = jest.fn(() => file);
  setCollectorLoaderForTesting(load);
  return { ...fake, load, arrive };
}

beforeEach(() => {
  localStorage.clear();
  document.cookie = "didit_pid=; Path=/; Max-Age=0";
  resetDeviceFingerprintForTesting();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  setCollectorLoaderForTesting(null);
  resetDeviceFingerprintForTesting();
});

describe("by default: the lite payload with the collector's evidence", () => {
  it("carries the evidence once the collector is there, and never has the full fingerprint collected", async () => {
    const collector = collectorLoaded();

    const payload = await getDeviceFingerprintPayload();

    expect(payload?.signals.tier).toBe("lite");
    expect(payload?.evidence).toBe(FAKE_EVIDENCE);
    expect(payload?.compositeHash.length).toBe(22);
    // Clients send facts; the score is decided on Didit's servers.
    expect(payload).not.toHaveProperty("bot");
    // No canvas, audio, font or graphics read: the collector was only asked for its evidence.
    expect(collector.collect).not.toHaveBeenCalled();
  });

  it("waits for the collector for two seconds at most, and goes out without the evidence", async () => {
    jest.useFakeTimers();
    const collector = collectorLoading();

    let settled = false;
    const pending = getDeviceFingerprintPayload().then((payload) => {
      settled = true;
      return payload;
    });
    await jest.advanceTimersByTimeAsync(COLLECTOR_WAIT_MS - 1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    const late = await pending;

    expect(late?.signals.tier).toBe("lite");
    expect(late).not.toHaveProperty("evidence");

    collector.arrive();
    await flushPromises();
    expect((await getDeviceFingerprintPayload())?.evidence).toBe(FAKE_EVIDENCE);
    // One load, however many requests asked.
    expect(collector.load).toHaveBeenCalledTimes(1);
  });

  it("goes out with the lite payload alone when the collector cannot be loaded, and does not load it again", async () => {
    const load = jest.fn(() => Promise.reject(new Error("blocked")));
    setCollectorLoaderForTesting(load);

    const first = await getDeviceFingerprintPayload();
    const second = await getDeviceFingerprintPayload();

    expect(first?.signals.tier).toBe("lite");
    expect(first).not.toHaveProperty("evidence");
    expect(second).not.toHaveProperty("evidence");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reads the evidence again for every request, and keeps the last one when a read fails", async () => {
    const collector = collectorLoaded();
    const read = jest.spyOn(collector.collector, "evidence");

    expect((await getDeviceFingerprintPayload())?.evidence).toBe(FAKE_EVIDENCE);
    read.mockReturnValue('{"v":2,"p":"web","wd":1}');
    expect((await getDeviceFingerprintPayload())?.evidence).toBe('{"v":2,"p":"web","wd":1}');
    read.mockImplementation(() => {
      throw new Error("boom");
    });
    expect((await getDeviceFingerprintPayload())?.evidence).toBe('{"v":2,"p":"web","wd":1}');
  });
});

describe("configureDevice({ fullFingerprint: true })", () => {
  beforeEach(() => configureDevice({ fullFingerprint: true }));

  it("returns the collector's full payload when it arrives in time, with the evidence", async () => {
    const collector = collectorLoaded();

    const pending = getDeviceFingerprintPayload();
    await flushPromises();
    collector.settle();
    const payload = await pending;

    expect(payload?.signals.tier).toBe("full");
    expect(payload?.evidence).toBe(FAKE_EVIDENCE);
    expect(payload).not.toHaveProperty("bot");
  });

  it("tells the collector the id it made up and stored, and to keep to the page's two stores", async () => {
    const collector = collectorLoaded();

    const lite = await getDeviceFingerprintPayload({ tier: "lite" });
    void getDeviceFingerprintPayload();
    await flushPromises();

    expect(lite?.persistentIdWasCreated).toBe(true);
    expect(collector.storedIdWhenCollecting).toEqual([lite?.persistentId]);
    expect(collector.collect).toHaveBeenCalledWith({
      embedderPersistentId: null,
      newPersistentId: lite?.persistentId,
      durableId: false,
    });
  });

  it("does not pass an id it read from a store as one it made up", async () => {
    localStorage.setItem(STORAGE_KEY, STORED_ID);
    const collector = collectorLoaded();

    void getDeviceFingerprintPayload();
    await flushPromises();

    expect(collector.collect).toHaveBeenCalledWith({
      embedderPersistentId: null,
      newPersistentId: null,
      durableId: false,
    });
  });

  it("goes out with the lite payload after the bound, and uses the collector's once it arrived", async () => {
    jest.useFakeTimers();
    const collector = collectorLoaded();

    let settled = false;
    const pending = getDeviceFingerprintPayload().then((payload) => {
      settled = true;
      return payload;
    });
    await jest.advanceTimersByTimeAsync(COLLECTOR_WAIT_MS - 1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    const lite = await pending;
    expect(lite?.signals.tier).toBe("lite");

    collector.settle();
    await flushPromises();
    const full = await getDeviceFingerprintPayload();

    expect(full?.signals.tier).toBe("full");
    expect(full?.persistentId).toBe(lite?.persistentId);
    // One collection, however many requests asked.
    expect(collector.collect).toHaveBeenCalledTimes(1);
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
    const collector = collectorLoaded();
    fail(collector.collect);

    expect((await getDeviceFingerprintPayload())?.signals.tier).toBe("lite");

    collector.collect.mockImplementation(async (options) => fullPayload(options));
    expect((await getDeviceFingerprintPayload())?.signals.tier).toBe("full");
    expect(collector.collect).toHaveBeenCalledTimes(2);
  });

  it("reports a new device as created in both payloads, under one id", async () => {
    const collector = collectorLoaded();

    const pending = getDeviceFingerprintPayload();
    await flushPromises();
    collector.settle();
    const full = await pending;
    const lite = await getDeviceFingerprintPayload({ tier: "lite" });

    expect(identity(full)).toEqual([localStorage.getItem(STORAGE_KEY), ["fresh"], true]);
    expect(identity(lite)).toEqual([localStorage.getItem(STORAGE_KEY), ["fresh"], true]);
  });

  it("names one device where storage is blocked: the collector is told the id kept in memory", async () => {
    const blocked = (): never => {
      throw new Error("blocked");
    };
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    jest.spyOn(document, "cookie", "set").mockImplementation(blocked);
    const collector = collectorLoaded();

    const pending = getDeviceFingerprintPayload();
    await flushPromises();
    collector.settle();
    const full = await pending;
    const lite = await getDeviceFingerprintPayload({ tier: "lite" });

    expect(lite?.persistentId).toMatch(/^[A-Za-z0-9_-]{20,32}$/);
    expect(full?.persistentId).toBe(lite?.persistentId);
    expect(collector.collect).toHaveBeenCalledWith({
      embedderPersistentId: null,
      newPersistentId: lite?.persistentId,
      durableId: false,
    });
  });

  it("keeps the id it made up while the collector could not be loaded, on the next page, where it loads", async () => {
    setCollectorLoaderForTesting(() => Promise.reject(new Error("blocked")));
    const first = await getDeviceFingerprintPayload();
    expect(first?.signals.tier).toBe("lite");
    expect(first?.persistentIdWasCreated).toBe(true);

    // The next page: the package starts again, and the browser's storage is what it was.
    resetDeviceFingerprintForTesting();
    configureDevice({ fullFingerprint: true });
    const collector = collectorLoaded();
    const pending = getDeviceFingerprintPayload();
    await flushPromises();
    collector.settle();
    const second = await pending;
    const lite = await getDeviceFingerprintPayload({ tier: "lite" });

    expect(second?.signals.tier).toBe("full");
    // Booleans, so a failure prints no id.
    expect(Boolean(first?.persistentId) && second?.persistentId === first?.persistentId).toBe(true);
    expect(lite?.persistentId === first?.persistentId).toBe(true);
    expect([second?.persistentIdWasCreated, lite?.persistentIdWasCreated]).toEqual([false, false]);
    // The id was read from a store: the collector is not told it as one made up on this page.
    expect(collector.collect).toHaveBeenCalledWith({
      embedderPersistentId: null,
      newPersistentId: null,
      durableId: false,
    });
  });

  it("leaves the lite payload what it is: the same id and hash, and no evidence", async () => {
    const before = await getDeviceFingerprintPayload({ tier: "lite" });
    const collector = collectorLoaded();
    const full = getDeviceFingerprintPayload();
    await flushPromises();
    collector.settle();
    expect((await full)?.signals.tier).toBe("full");

    const after = await getDeviceFingerprintPayload({ tier: "lite" });

    expect(after?.signals.tier).toBe("lite");
    expect(after?.persistentId === before?.persistentId).toBe(true);
    expect(sameHash(after, before)).toBe(true);
    expect(after).not.toHaveProperty("evidence");
  });
});

describe("getDeviceFingerprintPayload({ tier: \"lite\" })", () => {
  it("answers with the lite payload and its hash, never loads the collector, and carries no evidence", async () => {
    const collector = collectorLoaded();

    const payload = await getDeviceFingerprintPayload({ tier: "lite" });

    expect(payload?.signals.tier).toBe("lite");
    expect(payload?.persistentId).toBe(localStorage.getItem(STORAGE_KEY));
    expect(payload?.compositeHash.length).toBe(22);
    expect(payload).not.toHaveProperty("evidence");
    expect(collector.load).not.toHaveBeenCalled();
  });

  it("waits for its hash for two seconds at most", async () => {
    jest.useFakeTimers();
    hashNeverAnswers();

    let settled = false;
    const pending = getDeviceFingerprintPayload({ tier: "lite" }).then((payload) => {
      settled = true;
      return payload;
    });
    await jest.advanceTimersByTimeAsync(COLLECTOR_WAIT_MS - 1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    expect((await pending)?.compositeHash === "").toBe(true);
  });

  it("with wait: false answers at once with the payload as it is, and carries the hash once it has been computed", async () => {
    jest.useFakeTimers();
    const collector = collectorLoaded();

    // No timer is advanced, here or below: no answer waits for the two seconds.
    const first = await getDeviceFingerprintPayload({ tier: "lite", wait: false });
    expect(jest.getTimerCount()).toBe(0);
    // A read that waits ends when the digest has answered, so the hash is there from here on.
    await getDeviceFingerprintPayload({ tier: "lite" });
    const later = await getDeviceFingerprintPayload({ tier: "lite", wait: false });

    expect(first?.signals.tier).toBe("lite");
    expect(first?.persistentId).toBe(localStorage.getItem(STORAGE_KEY));
    expect(later?.compositeHash.length).toBe(22);
    expect(collector.load).not.toHaveBeenCalled();
  });

  it("with wait: false and a hash that never comes, still answers at once", async () => {
    jest.useFakeTimers();
    hashNeverAnswers();

    const payload = await getDeviceFingerprintPayload({ tier: "lite", wait: false });

    expect(payload?.compositeHash === "").toBe(true);
    expect(payload?.persistentId).toBe(localStorage.getItem(STORAGE_KEY));
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe("getDeviceFingerprintPayload({ wait: false })", () => {
  it("answers at once with the lite payload, lets the collector load, and carries its evidence once it is there", async () => {
    jest.useFakeTimers();
    const collector = collectorLoading();

    // No timer is advanced: the answer did not wait for the collector.
    const first = await getDeviceFingerprintPayload({ wait: false });
    expect(first?.signals.tier).toBe("lite");
    expect(first).not.toHaveProperty("evidence");
    expect(collector.load).toHaveBeenCalledTimes(1);

    collector.arrive();
    await flushPromises();

    expect((await getDeviceFingerprintPayload({ wait: false }))?.evidence).toBe(FAKE_EVIDENCE);
    expect(collector.load).toHaveBeenCalledTimes(1);
  });

  it("gives the full payload once it is collected, on a page that asked for the full fingerprint", async () => {
    jest.useFakeTimers();
    configureDevice({ fullFingerprint: true });
    const collector = collectorLoaded();

    expect((await getDeviceFingerprintPayload({ wait: false }))?.signals.tier).toBe("lite");
    await flushPromises();
    collector.settle();
    await flushPromises();

    expect((await getDeviceFingerprintPayload({ wait: false }))?.signals.tier).toBe("full");
    expect(collector.collect).toHaveBeenCalledTimes(1);
  });
});

describe("the two seconds a request waits", () => {
  it("end for the lite payload too: with neither the collector nor the hash, the request goes out without a hash", async () => {
    jest.useFakeTimers();
    hashNeverAnswers();
    collectorLoading();

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
  });

  it("are not spent when the collector cannot be loaded: the request goes out as soon as the hash is there", async () => {
    jest.useFakeTimers();
    setCollectorLoaderForTesting(() => Promise.reject(new Error("blocked")));

    // No timer is advanced: had the request waited for the two seconds, this would never answer.
    const payload = await getDeviceFingerprintPayload();

    expect(payload?.signals.tier).toBe("lite");
    expect(payload?.compositeHash.length).toBe(22);
  });

  it("leave nothing behind for a request whose time ran out, however many there were, and one load serves them all", async () => {
    jest.useFakeTimers();
    const collector = collectorLoading();

    const requests = Array.from({ length: 200 }, () => getDeviceFingerprintPayload());
    await flushPromises();
    expect(waitingCountForTesting()).toBe(200);
    await jest.advanceTimersByTimeAsync(COLLECTOR_WAIT_MS);
    const payloads = await Promise.all(requests);

    expect(payloads.every((payload) => payload?.signals.tier === "lite")).toBe(true);
    // The collector is still loading, and no request is still attached to it.
    expect(waitingCountForTesting()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    expect(collector.load).toHaveBeenCalledTimes(1);
  });
});

describe("the device id: the page's two stores", () => {
  it("is stored at once in both when the page makes one up", async () => {
    const lite = await getDeviceFingerprintPayload({ tier: "lite" });

    expect(identity(lite)).toEqual([localStorage.getItem(STORAGE_KEY), ["fresh"], true]);
    expect(document.cookie).toContain(`didit_pid=${lite?.persistentId}`);
  });

  it("is written to the store that lacked it", async () => {
    localStorage.setItem(STORAGE_KEY, STORED_ID);

    const lite = await getDeviceFingerprintPayload({ tier: "lite" });

    expect(identity(lite)).toEqual([STORED_ID, ["localStorage"], false]);
    expect(document.cookie).toContain(`didit_pid=${STORED_ID}`);
  });

  it("is handed out as the stores hold it now: an id another tab settled since reaches the next payload", async () => {
    const collector = collectorLoaded();
    const before = await getDeviceFingerprintPayload();
    expect(before?.persistentIdWasCreated).toBe(true);

    localStorage.setItem(STORAGE_KEY, OTHER_ID);
    const after = await getDeviceFingerprintPayload();

    expect(identity(after)).toEqual([OTHER_ID, ["localStorage"], false]);
    expect(identity(await getDeviceFingerprintPayload({ tier: "lite" }))).toEqual([OTHER_ID, ["localStorage"], false]);
    expect(identity(getAvailableDeviceFingerprintPayload())).toEqual([OTHER_ID, ["localStorage"], false]);
    expect(sameHash(after, before)).toBe(true);
    expect(collector.collect).not.toHaveBeenCalled();
  });
});

describe("configureDevice({ embedderDeviceId }): a page inside another site's frame", () => {
  it("goes by the embedding page's id while its own storage has none, and writes it nowhere", async () => {
    collectorLoaded();
    configureDevice({ embedderDeviceId: EMBEDDER_ID });

    const payload = await getDeviceFingerprintPayload();

    expect(identity(payload)).toEqual([EMBEDDER_ID, ["embedder"], false]);
    expect(payload?.signals.embedder).toEqual({ persistentId: EMBEDDER_ID });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(document.cookie).not.toContain("didit_pid");
  });

  it("hands the collector the embedding page's id, and no made-up one, where the full fingerprint is on", async () => {
    const collector = collectorLoaded();
    configureDevice({ fullFingerprint: true });
    configureDevice({ embedderDeviceId: EMBEDDER_ID });

    void getDeviceFingerprintPayload();
    await flushPromises();

    // The second call kept the first one's setting.
    expect(collector.collect).toHaveBeenCalledWith({
      embedderPersistentId: EMBEDDER_ID,
      newPersistentId: null,
      durableId: false,
    });
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

  it.each([["a script"], ["<script>alert(1)</script>"], [""], ["short"], [null]])(
    "ignores %j, which is not a device id",
    async (passed) => {
      configureDevice({ embedderDeviceId: passed });

      const lite = await getDeviceFingerprintPayload({ tier: "lite" });

      expect(lite?.persistentIdWasCreated).toBe(true);
      expect(lite?.signals).not.toHaveProperty("embedder");
      expect(localStorage.getItem(STORAGE_KEY)).toBe(lite?.persistentId);
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

  it("gives the lite payload before its hash, then with it, then with the evidence once the collector is there", async () => {
    const collector = collectorLoading();

    const pending = getDeviceFingerprintPayload({ wait: false });
    // The lite payload exists before its hash does.
    expect(getAvailableDeviceFingerprintPayload()?.signals.tier).toBe("lite");
    expect(getAvailableDeviceFingerprintPayload()?.compositeHash === "").toBe(true);
    await pending;

    await getDeviceFingerprintPayload({ tier: "lite" });
    expect(getAvailableDeviceFingerprintPayload()?.compositeHash.length).toBe(22);
    expect(getAvailableDeviceFingerprintPayload()).not.toHaveProperty("evidence");

    collector.arrive();
    await flushPromises();
    // Read once when the collector arrived: an exiting page does not read the page again.
    const read = jest.spyOn(collector.collector, "evidence");
    expect(getAvailableDeviceFingerprintPayload()?.evidence).toBe(FAKE_EVIDENCE);
    expect(read).not.toHaveBeenCalled();
  });

  it("gives the collector's full payload once it is collected, on a page that asked for the full fingerprint", async () => {
    configureDevice({ fullFingerprint: true });
    const collector = collectorLoaded();

    void getDeviceFingerprintPayload();
    await flushPromises();
    expect(getAvailableDeviceFingerprintPayload()?.signals.tier).toBe("lite");
    collector.settle();
    await flushPromises();

    expect(getAvailableDeviceFingerprintPayload()?.signals.tier).toBe("full");
  });
});

describe("getSignalsEvidence", () => {
  it("gives the evidence text when the collector is there in time", async () => {
    const collector = collectorLoaded();

    await expect(getSignalsEvidence()).resolves.toBe(FAKE_EVIDENCE);
    expect(collector.collect).not.toHaveBeenCalled();
  });

  it("gives null when the collector is not there after two seconds", async () => {
    jest.useFakeTimers();
    collectorLoading();

    const pending = getSignalsEvidence();
    await jest.advanceTimersByTimeAsync(COLLECTOR_WAIT_MS);

    await expect(pending).resolves.toBeNull();
  });

  it("with wait: false answers at once with null, lets the collector load, and has the evidence once it is there", async () => {
    jest.useFakeTimers();
    const collector = collectorLoading();

    // No timer is advanced: an answer here did not wait for anything.
    await expect(getSignalsEvidence({ wait: false })).resolves.toBeNull();
    // Still loading: still null, and the load is not started twice.
    await expect(getSignalsEvidence({ wait: false })).resolves.toBeNull();
    expect(collector.load).toHaveBeenCalledTimes(1);

    collector.arrive();
    await flushPromises();

    await expect(getSignalsEvidence({ wait: false })).resolves.toBe(FAKE_EVIDENCE);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("waits for the collection where the full fingerprint is on, so the evidence has what the probes found", async () => {
    configureDevice({ fullFingerprint: true });
    const collector = collectorLoaded();

    let answered = false;
    const pending = getSignalsEvidence().then((evidence) => {
      answered = true;
      return evidence;
    });
    await flushPromises();
    expect(answered).toBe(false);
    collector.settle();

    await expect(pending).resolves.toBe(FAKE_EVIDENCE);
  });

  it("gives null, and never rejects, when the load fails or evidence() throws", async () => {
    setCollectorLoaderForTesting(() => Promise.reject(new Error("blocked")));
    await expect(getSignalsEvidence()).resolves.toBeNull();
    await expect(getSignalsEvidence({ wait: false })).resolves.toBeNull();

    resetDeviceFingerprintForTesting();
    const broken = fakeCollector();
    broken.collector.evidence = () => {
      throw new Error("boom");
    };
    setCollectorLoaderForTesting(async () => broken.collector);
    await expect(getSignalsEvidence()).resolves.toBeNull();
    await expect(getSignalsEvidence({ wait: false })).resolves.toBeNull();
  });

  it("gives null, and never rejects, when the collection fails", async () => {
    configureDevice({ fullFingerprint: true });
    const failing = fakeCollector();
    failing.collect.mockRejectedValue(new Error("boom"));
    setCollectorLoaderForTesting(async () => failing.collector);

    await expect(getSignalsEvidence()).resolves.toBeNull();
  });
});
