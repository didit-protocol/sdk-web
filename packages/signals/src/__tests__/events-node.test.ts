/**
 * @jest-environment node
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { flush, resetEventsForTesting, submitEvent } from "../events";
import { recordedEvents, replay, scenario, sentRequests } from "./device-lane";

describe("submitEvent outside a browser (server rendering, workers)", () => {
  let fetchMock: jest.Mock<typeof fetch>;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    resetEventsForTesting();
    fetchMock = jest.fn<typeof fetch>();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    resetEventsForTesting();
    globalThis.fetch = realFetch;
  });

  it("sends without a device fingerprint and without page listeners", async () => {
    fetchMock.mockImplementation(replay("timer"));

    for (const event of recordedEvents("timer")) submitEvent({ monitoringToken: scenario("timer").token, event });
    const result = await flush();

    const [request] = sentRequests(fetchMock);
    expect(request.body).toEqual({ events: scenario("timer").request.events });
    expect(Object.keys(request.init.headers).sort()).toEqual(["Content-Type", "X-Monitoring-Token"]);
    expect(result).toMatchObject({ acceptedCount: 1, pendingCount: 0 });
  });

  it("refuses to queue when the environment has no fetch", () => {
    // @ts-expect-error simulating a runtime without fetch
    globalThis.fetch = undefined;

    expect(() => submitEvent({ monitoringToken: "valid", event: { category: "auth", actionType: "login" } })).toThrow(
      expect.objectContaining({ type: "network" })
    );
  });
});
