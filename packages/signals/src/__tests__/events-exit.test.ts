import { webcrypto } from "node:crypto";
import { TextEncoder } from "node:util";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { configureEvents, flush, resetEventsForTesting, submitEvent } from "../events";
import { getDeviceFingerprintPayload, resetDeviceFingerprintForTesting } from "../fingerprint";
import { recordedBody, recordedEvents, replay, respond, scenario, sentRequests } from "./device-lane";

const originalEncoder = Object.getOwnPropertyDescriptor(globalThis, "TextEncoder");
const originalSubtle = Object.getOwnPropertyDescriptor(crypto, "subtle");

describe("event delivery while the native fingerprint hash is pending", () => {
  let fetchMock: jest.Mock<typeof fetch>;
  let releaseHash: () => Promise<void>;
  let fingerprint: ReturnType<typeof getDeviceFingerprintPayload>;

  beforeEach(() => {
    resetEventsForTesting();
    resetDeviceFingerprintForTesting();
    localStorage.clear();
    Object.defineProperty(globalThis, "TextEncoder", { configurable: true, value: TextEncoder });
    Object.defineProperty(crypto, "subtle", {
      configurable: true,
      value: { digest: (algorithm: string, data: ArrayBuffer) => new Promise<ArrayBuffer>((resolve) => {
        releaseHash = async () => resolve(await webcrypto.subtle.digest(algorithm, data));
      }) }
    });
    fetchMock = jest.fn<typeof fetch>().mockImplementation(replay("exit", "timer"));
    globalThis.fetch = fetchMock;
    fingerprint = getDeviceFingerprintPayload();
  });

  afterEach(async () => {
    await releaseHash();
    await fingerprint;
    await flush();
    resetEventsForTesting();
    resetDeviceFingerprintForTesting();
    if (originalEncoder) Object.defineProperty(globalThis, "TextEncoder", originalEncoder);
    else Reflect.deleteProperty(globalThis, "TextEncoder");
    if (originalSubtle) Object.defineProperty(crypto, "subtle", originalSubtle);
    else Reflect.deleteProperty(crypto, "subtle");
    Reflect.deleteProperty(globalThis, "fetch");
    jest.restoreAllMocks();
  });

  it.each(["pagehide", "visibilitychange"])("starts keepalive inside the %s handler without waiting for the hash", async (eventType) => {
    const events = recordedEvents("exit");

    events.forEach((event) => submitEvent({ monitoringToken: "valid", event }));
    if (eventType === "visibilitychange") {
      jest.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      document.dispatchEvent(new Event(eventType));
    } else {
      window.dispatchEvent(new Event(eventType));
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [sent] = sentRequests(fetchMock);

    expect(sent.init.keepalive).toBe(true);
    expect(sent.body.events).toEqual(scenario("exit").request.events);
    expect(sent.body.fingerprint_v2?.persistentId).toBe(localStorage.getItem("didit-pid-v1"));
    expect(sent.init.headers["X-Didit-PID"]).toBe(sent.body.fingerprint_v2?.persistentId);
    expect(sent.init.headers).not.toHaveProperty("X-Didit-FP-Hash");
    await releaseHash();
    const full = await fingerprint;

    expect(sent.body.fingerprint_v2).toEqual({ ...full, compositeHash: "" });
    expect(full?.compositeHash).toHaveLength(22);
    expect((await flush()).pendingCount).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the complete cached fingerprint synchronously when the hash has finished", async () => {
    await releaseHash();
    const full = await fingerprint;

    recordedEvents("exit").forEach((event) => submitEvent({ monitoringToken: "valid", event }));
    window.dispatchEvent(new Event("pagehide"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentRequests(fetchMock)[0].body.fingerprint_v2).toEqual(full);
  });

  it("reserves pending exit batches across repeated exits and concurrent flush", async () => {
    let completeSend: (response: Response) => void = () => undefined;
    const response = new Promise<Response>((resolve) => { completeSend = resolve; });

    fetchMock.mockReturnValueOnce(response);
    recordedEvents("exit").forEach((event) => submitEvent({ monitoringToken: "valid", event }));
    const flushing = flush();
    await Promise.resolve();
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pagehide"));
    try {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sentRequests(fetchMock)[0].init.keepalive).toBe(true);
    } finally {
      completeSend(respond(201, recordedBody("exit")));
      await releaseHash();
      await flushing;
    }
    expect((await flush()).pendingCount).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves full event retries after an exit failure and later hash completion", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Network unavailable"));
    recordedEvents("exit").forEach((event) => submitEvent({ monitoringToken: "valid", event }));
    window.dispatchEvent(new Event("pagehide"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await releaseHash();
    await fingerprint;
    expect(await flush()).toMatchObject({ acceptedCount: 2, pendingCount: 0 });
    const [first, second] = sentRequests(fetchMock);

    expect(second.body.events).toEqual(first.body.events);
    expect(second.init.headers["X-Monitoring-Token"]).toBe(first.init.headers["X-Monitoring-Token"]);
    expect(second.body.fingerprint_v2?.persistentId).toBe(first.body.fingerprint_v2?.persistentId);
    expect(second.body.fingerprint_v2?.compositeHash).toBeTruthy();
  });

  it("counts available Unicode fingerprint bytes against the shared keepalive budget", async () => {
    await releaseHash();
    await fingerprint;
    resetDeviceFingerprintForTesting();
    jest.spyOn(navigator, "userAgent", "get").mockReturnValue("語".repeat(8000));
    fingerprint = getDeviceFingerprintPayload();
    configureEvents({ batchSize: 500 });
    submitEvent({ monitoringToken: "valid", event: { category: "custom", actionType: "large", payload: { text: "語".repeat(18000) } } });
    window.dispatchEvent(new Event("pagehide"));
    expect(fetchMock).not.toHaveBeenCalled();
    // Do not let cleanup retry this deliberately oversized, unrecorded event.
    resetEventsForTesting();
  });
});
