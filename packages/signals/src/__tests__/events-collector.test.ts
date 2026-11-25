import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { installWebCryptoForTests } from "../device/__tests__/_test_setup";

installWebCryptoForTests();
import { setCollectorLoaderForTesting } from "../collector";
import { configureEvents, flush, resetEventsForTesting, submitEvent } from "../events";
import {
  COLLECTOR_WAIT_MS,
  configureDevice,
  getDeviceFingerprintPayload,
  resetDeviceFingerprintForTesting,
} from "../fingerprint";
import { recordedEvents, replay, scenario, sentRequests } from "./device-lane";
import { FAKE_EVIDENCE, fakeCollector } from "./fake-collector";

async function flushPromises(): Promise<void> {
  for (let round = 0; round < 20; round++) await Promise.resolve();
}

function submitRecorded(name: "accepted" | "timer" | "exit"): void {
  recordedEvents(name).forEach((event) => submitEvent({ monitoringToken: scenario(name).token, event }));
}

describe("events carry the collector's evidence and no score", () => {
  let fetchMock: jest.Mock<typeof fetch>;

  beforeEach(() => {
    resetEventsForTesting();
    localStorage.clear();
    document.cookie = "didit_pid=; Path=/; Max-Age=0";
    resetDeviceFingerprintForTesting();
    fetchMock = jest.fn<typeof fetch>().mockImplementation(replay("accepted", "timer", "exit"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    configureEvents({});
  });

  afterEach(() => {
    resetEventsForTesting();
    jest.useRealTimers();
    setCollectorLoaderForTesting(null);
    resetDeviceFingerprintForTesting();
    Reflect.deleteProperty(globalThis, "fetch");
  });

  it("sends fingerprint_v2.evidence as text with the lite fingerprint, never a bot member or a score header", async () => {
    const fake = fakeCollector();
    setCollectorLoaderForTesting(async () => fake.collector);

    submitRecorded("accepted");
    await flush();

    const [request] = sentRequests(fetchMock);
    expect(request.body.fingerprint_v2?.evidence).toBe(FAKE_EVIDENCE);
    expect(request.body.fingerprint_v2?.signals).toMatchObject({ tier: "lite" });
    // By default the collector is asked for its evidence only: no full fingerprint is collected.
    expect(fake.collect).not.toHaveBeenCalled();
    expect(request.body.fingerprint_v2).not.toHaveProperty("bot");
    expect(request.init.headers).not.toHaveProperty("X-Didit-FP-Bot-Score");
    expect(Object.keys(request.init.headers).filter((name) => name.startsWith("X-Didit-")).sort()).toEqual([
      "X-Didit-FP-Hash",
      "X-Didit-FP-V2",
      "X-Didit-FP-Webview",
      "X-Didit-PID",
    ]);
  });

  it("sends the full fingerprint with its evidence on a page that asked for it", async () => {
    configureDevice({ fullFingerprint: true });
    const fake = fakeCollector();
    setCollectorLoaderForTesting(async () => fake.collector);

    submitRecorded("accepted");
    const flushed = flush();
    await flushPromises();
    fake.settle();
    await flushed;

    const [request] = sentRequests(fetchMock);
    expect(request.body.fingerprint_v2?.signals).toMatchObject({ tier: "full" });
    expect(request.body.fingerprint_v2?.evidence).toBe(FAKE_EVIDENCE);
    expect(request.body.fingerprint_v2).not.toHaveProperty("bot");
  });

  it("sends the evidence on the page-exit path once the collector is there, with no wait and no score header", async () => {
    const fake = fakeCollector();
    setCollectorLoaderForTesting(async () => fake.collector);
    // The collector arrived earlier on this page.
    await getDeviceFingerprintPayload();

    submitRecorded("exit");
    window.dispatchEvent(new Event("pagehide"));

    const exitRequest = sentRequests(fetchMock).slice(-1)[0];
    expect(exitRequest.init.keepalive).toBe(true);
    expect(exitRequest.body.fingerprint_v2?.evidence).toBe(FAKE_EVIDENCE);
    expect(exitRequest.body.fingerprint_v2).not.toHaveProperty("bot");
    expect(exitRequest.init.headers).not.toHaveProperty("X-Didit-FP-Bot-Score");
  });

  it("sends the lite payload alone on the exit path while the collector is not there yet", () => {
    const fake = fakeCollector();
    setCollectorLoaderForTesting(async () => fake.collector);

    submitRecorded("exit");
    window.dispatchEvent(new Event("pagehide"));

    const [request] = sentRequests(fetchMock);
    expect(request.body.fingerprint_v2).not.toHaveProperty("evidence");
    expect(request.body.fingerprint_v2).not.toHaveProperty("bot");
    expect(request.init.headers).not.toHaveProperty("X-Didit-FP-Bot-Score");
    expect(fake.collect).not.toHaveBeenCalled();
  });

  it.each([
    ["cannot be loaded", () => setCollectorLoaderForTesting(() => Promise.reject(new Error("blocked")))],
    [
      "fails to collect the full fingerprint a page asked for",
      () => {
        configureDevice({ fullFingerprint: true });
        const fake = fakeCollector();
        fake.collect.mockRejectedValue(new Error("boom"));
        setCollectorLoaderForTesting(async () => fake.collector);
      },
    ],
  ])("still delivers the events, without delay, when the collector %s", async (_name, arrange) => {
    arrange();

    submitRecorded("accepted");
    const result = await flush();

    expect(result.pendingCount).toBe(0);
    const [request] = sentRequests(fetchMock);
    expect(request.body.fingerprint_v2?.signals).toMatchObject({ tier: "lite" });
    expect(request.body.fingerprint_v2).not.toHaveProperty("evidence");
  });

  it("a flush with nothing to send loads no collector, collects nothing and stores no id", async () => {
    const fake = fakeCollector();
    const load = jest.fn(async () => fake.collector);
    setCollectorLoaderForTesting(load);

    const result = await flush();
    await flushPromises();

    expect(result).toEqual({ acceptedCount: 0, replayedCount: 0, rejectedCount: 0, pendingCount: 0, results: [] });
    expect(load).not.toHaveBeenCalled();
    expect(fake.collect).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("didit-pid-v1")).toBeNull();
    expect(document.cookie).not.toContain("didit_pid");
  });

  it("never holds a flush longer than the bound when the collector never arrives", async () => {
    jest.useFakeTimers();
    setCollectorLoaderForTesting(() => new Promise(() => undefined));

    submitRecorded("accepted");
    const flushed = flush();
    await flushPromises();
    expect(fetchMock).not.toHaveBeenCalled();
    jest.advanceTimersByTime(COLLECTOR_WAIT_MS);
    const result = await flushed;

    expect(result.pendingCount).toBe(0);
    expect(sentRequests(fetchMock)[0].body.fingerprint_v2?.signals).toMatchObject({ tier: "lite" });
  });
});
