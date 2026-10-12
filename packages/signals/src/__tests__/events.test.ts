import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  DiditEventError,
  buildEventRequestBody,
  classifyEventError,
  configureEvents,
  flush,
  resetEventsForTesting,
  submitEvent
} from "../events";
import { resetDeviceFingerprintForTesting } from "../fingerprint";
import type { DiditEvent, DiditEventErrorType } from "../types";
import {
  recordedBody,
  recordedEvents,
  replay,
  respond,
  scenario,
  sentRequests,
  type ScenarioName
} from "./device-lane";

interface RecordedBatch {
  results: Record<string, unknown>[];
}

const BATCH_URL = "https://verification.didit.me/v1/events/batch/";

function submitRecorded(name: ScenarioName, token = scenario(name).token): string[] {
  return recordedEvents(name).map((event) => submitEvent({ monitoringToken: token, event }));
}

/** Lets queued promise jobs and zero-delay timers run (real timers only). */
async function settle(): Promise<void> {
  for (let round = 0; round < 20; round++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

describe("submitEvent and flush against the recorded device lane", () => {
  let fetchMock: jest.Mock<typeof fetch>;
  let onError: jest.Mock<(error: DiditEventError) => void>;

  beforeEach(() => {
    resetEventsForTesting();
    resetDeviceFingerprintForTesting();
    localStorage.clear();
    fetchMock = jest.fn<typeof fetch>();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    onError = jest.fn<(error: DiditEventError) => void>();
    configureEvents({ onError });
  });

  afterEach(() => {
    resetEventsForTesting();
    jest.useRealTimers();
    jest.restoreAllMocks();
    setVisibility("visible");
    // @ts-expect-error cleanup of the test-injected global
    delete globalThis.fetch;
  });

  it("posts the batch in the wire format the service accepted, with the token header and device fingerprint", async () => {
    fetchMock.mockImplementation(replay("accepted"));

    const ids = submitRecorded("accepted");
    const result = await flush();

    const [request] = sentRequests(fetchMock);
    expect(request.url).toBe(BATCH_URL);
    expect(request.init.method).toBe("POST");
    expect(request.init.keepalive).toBe(false);
    expect(request.init.headers["Content-Type"]).toBe("application/json");
    expect(request.init.headers["X-Monitoring-Token"]).toBe("valid");
    expect(request.body.events).toEqual(scenario("accepted").request.events);
    expect(request.body.fingerprint_v2?.schema).toBe("didit-fp-v2");
    expect(request.init.headers["X-Didit-PID"]).toBe(request.body.fingerprint_v2?.persistentId);
    expect(request.init.headers["X-Didit-FP-Hash"]).toBe(request.body.fingerprint_v2?.compositeHash);

    expect(ids).toEqual(["rec-signup-1", "rec-login-1", "rec-login-failed-1"]);
    expect(result).toMatchObject({ acceptedCount: 3, replayedCount: 0, rejectedCount: 0, pendingCount: 0 });
    expect(result.results).toEqual([
      { eventId: "rec-signup-1", outcome: "accepted", eventUuid: "f35f90f9-b95d-4be1-af47-40fa4f20e94d", status: "ACCEPTED", score: 0 },
      { eventId: "rec-login-1", outcome: "accepted", eventUuid: "b8412edc-cad7-41d9-8d50-197b17d55bc0", status: "ACCEPTED", score: 0 },
      { eventId: "rec-login-failed-1", outcome: "accepted", eventUuid: "99f79a44-9601-44a5-9e79-835360d795d3", status: "ACCEPTED", score: 0 }
    ]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a resent event the service already stored as replayed, not as an error", async () => {
    fetchMock.mockImplementation(replay("replayed"));

    submitRecorded("replayed");
    const result = await flush();

    expect(result).toMatchObject({ acceptedCount: 0, replayedCount: 3, rejectedCount: 0, pendingCount: 0 });
    expect(result.results.map((item) => item.outcome)).toEqual(["replayed", "replayed", "replayed"]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("settles a partially accepted batch per event and never resends the rejected ones", async () => {
    fetchMock.mockImplementation(replay("partial"));

    submitRecorded("partial");
    const result = await flush();

    expect(result).toMatchObject({ acceptedCount: 1, rejectedCount: 2, pendingCount: 0 });
    expect(result.results[0]).toMatchObject({ eventId: "rec-logout-1", outcome: "accepted" });
    expect(result.results[1].outcome).toBe("rejected");
    expect(result.results[1].error).toMatchObject({
      type: "validation",
      status: 207,
      eventIds: ["rec-deposit-1"],
      errors: { payload: ["payment.deposit_initiated requires: currency, payment_method, payment_reference_id, status."] }
    });
    expect(result.results[2].error).toMatchObject({
      type: "validation",
      eventIds: ["rec-login-1"],
      errors: { event_id: "event_id 'rec-login-1' already exists with a different payload." }
    });
    expect(onError.mock.calls.map(([error]) => error.eventIds)).toEqual([["rec-deposit-1"], ["rec-login-1"]]);

    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports an event outside the credential's categories as rejected", async () => {
    fetchMock.mockImplementation(replay("scoped"));

    submitRecorded("scoped");
    const result = await flush();

    expect(result).toMatchObject({ acceptedCount: 1, rejectedCount: 1, pendingCount: 0 });
    expect(result.results[1].error?.errors).toEqual({
      event_category: ["This credential may not submit 'auth' events."]
    });
  });

  it.each<[ScenarioName, DiditEventErrorType, unknown]>([
    ["invalid_token", "invalid_token", "Invalid monitoring token."],
    ["expired_token", "expired_token", "Monitoring token has expired."],
    ["used_up", "invalid_token", "Monitoring token exceeded its maximum number of uses."],
    ["revoked", "invalid_token", "Monitoring token has been revoked."],
    ["origin_bound", "invalid_token", "Monitoring token is not valid for this origin."],
    ["monitoring_disabled", "monitoring_disabled", expect.stringContaining("Event monitoring is not enabled")]
  ])("drops the whole batch when the service refuses it (%s)", async (name, type, message) => {
    fetchMock.mockImplementation(replay(name));

    const ids = submitRecorded(name);
    const result = await flush();

    const status = scenario(name).response.status;
    expect(result).toMatchObject({ acceptedCount: 0, rejectedCount: ids.length, pendingCount: 0 });
    expect(onError).toHaveBeenCalledTimes(1);
    const [error] = onError.mock.calls[0];
    expect(error).toBeInstanceOf(DiditEventError);
    expect(error).toMatchObject({ type, status, eventIds: ids, message });
    expect(result.results).toEqual(ids.map((eventId) => ({ eventId, outcome: "rejected", error })));

    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies a refused whole batch as a validation error with the service's details", () => {
    const error = classifyEventError(400, recordedBody("too_many"), ["a", "b"]);

    expect(error).toMatchObject({
      type: "validation",
      status: 400,
      eventIds: ["a", "b"],
      errors: { events: "A batch accepts at most 500 events; received 501." }
    });
  });

  it("keeps events after a network error and resends the same bytes, so the retry is a replay", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockImplementationOnce(replay("accepted"));

    submitRecorded("accepted");
    const failed = await flush();
    const retried = await flush();

    expect(failed).toMatchObject({ acceptedCount: 0, pendingCount: 3, results: [] });
    expect(retried).toMatchObject({ acceptedCount: 3, pendingCount: 0 });
    const [first, second] = fetchMock.mock.calls.map(([, init]) => init?.body);
    expect(second).toBe(first);
    expect(onError).not.toHaveBeenCalled();
  });

  it.each([
    ["a 503", respond(503, null)],
    ["a 429", respond(429, null)],
    ["an unreadable rejection", respond(400, "<html>")],
    ["a 2xx without per-event results", respond(200, "<html>")]
  ])("retries after %s", async (_label, answer) => {
    fetchMock.mockResolvedValueOnce(answer).mockImplementationOnce(replay("timer"));

    submitRecorded("timer");

    expect(await flush()).toMatchObject({ acceptedCount: 0, pendingCount: 1 });
    expect(await flush()).toMatchObject({ acceptedCount: 1, pendingCount: 0 });
  });

  it.each([
    ["unknown outcome", (body: RecordedBatch) => { body.results[0].outcome = "unknown"; }],
    ["missing index", (body: RecordedBatch) => { delete body.results[0].index; }],
    ["wrong index", (body: RecordedBatch) => { body.results[0].index = 8; }],
    ["missing stored id", (body: RecordedBatch) => { delete body.results[0].event_uuid; }],
    ["empty stored id", (body: RecordedBatch) => { body.results[0].event_uuid = ""; }],
    ["duplicate index", (body: RecordedBatch) => { body.results.push(body.results[0]); }]
  ])("keeps events pending after an acknowledgement with %s", async (_label, corrupt) => {
    const body = JSON.parse(JSON.stringify(recordedBody("timer")));

    corrupt(body);
    fetchMock.mockResolvedValueOnce(respond(201, body)).mockImplementationOnce(replay("timer"));
    submitRecorded("timer");
    expect(await flush()).toMatchObject({ acceptedCount: 0, rejectedCount: 0, pendingCount: 1 });
    expect(onError).not.toHaveBeenCalled();
    expect(await flush()).toMatchObject({ acceptedCount: 1, pendingCount: 0 });
  });

  it("does not settle a missing index using another event's position", async () => {
    const body = JSON.parse(JSON.stringify(recordedBody("accepted")));

    body.results = body.results.slice(1).reverse();
    fetchMock.mockResolvedValueOnce(respond(201, body));
    submitRecorded("accepted");
    expect(await flush()).toMatchObject({ acceptedCount: 2, rejectedCount: 0, pendingCount: 1 });
    expect(sentRequests(fetchMock)).toHaveLength(1);
  });

  it("counts a large Unicode fingerprint in the exact keepalive budget", async () => {
    const userAgent = jest.spyOn(window.navigator, "userAgent", "get").mockReturnValue("語".repeat(8000));

    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
    configureEvents({ batchSize: 500 });
    submitEvent({ monitoringToken: "valid", event: { category: "custom", actionType: "big", payload: { text: "語".repeat(18000) } } });
    window.dispatchEvent(new Event("pagehide"));
    await settle();
    expect(fetchMock.mock.calls.length).toBe(0);
    userAgent.mockRestore();
  });

  it("shares the keepalive budget across repeated page exits while requests are pending", async () => {
    const send = () => submitEvent({ monitoringToken: "valid", event: { category: "custom", actionType: "big", payload: { text: "x".repeat(40000) } } });

    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
    send();
    window.dispatchEvent(new Event("pagehide"));
    await settle();
    send();
    window.dispatchEvent(new Event("pagehide"));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("backs off after a failure instead of retrying on the normal interval", async () => {
    jest.useFakeTimers();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockImplementationOnce(replay("timer"));

    submitRecorded("timer");
    await jest.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(9999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends as soon as 25 events are waiting, without waiting for the timer", async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(replay("batch_of_25"));

    const ids = submitRecorded("batch_of_25");
    await jest.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentRequests(fetchMock)[0].body.events.map((event) => event.event_id)).toEqual(ids);
  });

  it("sends a waiting event once the 5 second interval elapses", async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(replay("timer"));

    submitRecorded("timer");
    await jest.advanceTimersByTimeAsync(4999);
    expect(fetchMock).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows the configured batch size, interval and base URL", async () => {
    jest.useFakeTimers();
    configureEvents({ batchSize: 2, flushIntervalMs: 1000, baseUrl: "https://events.example.test/" });
    fetchMock.mockImplementation(replay("exit"));

    submitRecorded("exit");
    await jest.advanceTimersByTimeAsync(0);

    expect(sentRequests(fetchMock)[0].url).toBe("https://events.example.test/v1/events/batch/");
  });

  it("sends with keepalive when the page is hidden, once", async () => {
    fetchMock.mockImplementation(replay("exit"));

    submitRecorded("exit");
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentRequests(fetchMock)[0].init.keepalive).toBe(true);
    expect(sentRequests(fetchMock)[0].body.events.map((event) => event.event_id)).toEqual(["rec-exit-1", "rec-exit-2"]);
    expect(await flush()).toMatchObject({ pendingCount: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends with keepalive on pagehide and settles the answer if the page stays", async () => {
    fetchMock.mockImplementation(replay("exit"));

    submitRecorded("exit");
    window.dispatchEvent(new Event("pagehide"));
    await settle();

    expect(sentRequests(fetchMock)[0].init.keepalive).toBe(true);
    expect(await flush()).toMatchObject({ pendingCount: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not send on a visibility change back to visible", async () => {
    fetchMock.mockImplementation(replay("exit"));

    submitRecorded("exit");
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps what is sent at page exit inside the browser's 64 KiB keepalive budget", async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
    const blob = "x".repeat(15000);

    for (let i = 0; i < 6; i++) {
      submitEvent({ monitoringToken: "valid", event: { category: "custom", actionType: "big", payload: { blob } } });
    }
    window.dispatchEvent(new Event("pagehide"));
    await settle();

    const bodies = fetchMock.mock.calls.map(([, init]) => String(init?.body));
    const sentEvents = bodies.reduce((count, body) => count + JSON.parse(body).events.length, 0);
    expect(sentEvents).toBeLessThan(6);
    expect(bodies.reduce((bytes, body) => bytes + body.length, 0)).toBeLessThanOrEqual(64 * 1024);
  });

  it("sends what did not fit at page exit on the normal timer when the page comes back", async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(replay("timer"));

    submitEvent({
      monitoringToken: "valid",
      event: { eventId: "too-big", category: "custom", actionType: "big", payload: { blob: "x".repeat(70000) } }
    });
    window.dispatchEvent(new Event("pagehide"));
    await jest.advanceTimersByTimeAsync(0);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
    await jest.advanceTimersByTimeAsync(5000);
    expect(sentRequests(fetchMock)[0].body.events.map((event) => event.event_id)).toEqual(["too-big"]);
    expect(sentRequests(fetchMock)[0].init.keepalive).toBe(false);
  });

  it("never puts events submitted with different tokens in the same request", async () => {
    fetchMock.mockImplementation(replay("accepted", "scoped"));
    const valid = recordedEvents("accepted");
    const sessionOnly = recordedEvents("scoped");

    submitEvent({ monitoringToken: "valid", event: valid[0] });
    submitEvent({ monitoringToken: "session_only", event: sessionOnly[0] });
    submitEvent({ monitoringToken: "valid", event: valid[1] });
    submitEvent({ monitoringToken: "session_only", event: sessionOnly[1] });
    submitEvent({ monitoringToken: "valid", event: valid[2] });
    const result = await flush();

    const requests = sentRequests(fetchMock);
    expect(requests.map((request) => request.init.headers["X-Monitoring-Token"])).toEqual(["valid", "session_only"]);
    expect(requests[0].body.events.map((event) => event.event_id)).toEqual(["rec-signup-1", "rec-login-1", "rec-login-failed-1"]);
    expect(result).toMatchObject({ acceptedCount: 4, rejectedCount: 1, pendingCount: 0 });
  });

  it("keeps the endpoint chosen at submission and isolates batches by endpoint", async () => {
    fetchMock.mockImplementation(replay("timer"));
    const [event] = recordedEvents("timer");

    submitEvent({ monitoringToken: "valid", event, baseUrl: "https://first.example.test" });
    configureEvents({ baseUrl: "https://second.example.test" });
    submitEvent({ monitoringToken: "valid", event });
    expect(await flush()).toMatchObject({ acceptedCount: 2, pendingCount: 0 });
    expect(sentRequests(fetchMock).map(({ url }) => url)).toEqual([
      "https://first.example.test/v1/events/batch/",
      "https://second.example.test/v1/events/batch/"
    ]);
  });

  it("freezes the event payload before the caller can mutate it", async () => {
    const events = recordedEvents("accepted").map((event) => JSON.parse(JSON.stringify(event)) as DiditEvent);

    fetchMock.mockImplementation(replay("accepted"));
    events.forEach((event) => submitEvent({ monitoringToken: "valid", event }));
    events[0].payload!.method = "changed";
    expect(await flush()).toMatchObject({ acceptedCount: 3, pendingCount: 0 });
    expect(sentRequests(fetchMock)[0].body.events).toEqual(scenario("accepted").request.events);
  });

  it("serializes concurrent explicit flushes without sending the batch twice", async () => {
    fetchMock.mockImplementation(replay("timer"));
    submitRecorded("timer");

    const results = await Promise.all([flush(), flush(), flush()]);

    expect(results.reduce((sum, result) => sum + result.acceptedCount, 0)).toBe(1);
    expect(results.every((result) => result.pendingCount === 0)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("drops low-value events first when the queue is full and never drops payment events", async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
    configureEvents({ maxQueueSize: 3, batchSize: 500 });
    const send = (eventId: string, category: DiditEvent["category"], actionType: string): string =>
      submitEvent({ monitoringToken: "valid", event: { eventId, category, actionType } });

    send("page-1", "session", "page_view");
    send("login-1", "auth", "login");
    send("deposit-1", "payment", "deposit_initiated");
    send("login-2", "auth", "login");
    send("page-2", "session", "page_view");
    send("deposit-2", "payment", "deposit_initiated");
    send("deposit-3", "payment", "deposit_initiated");
    send("deposit-4", "payment", "deposit_initiated");
    flush().catch(() => undefined);
    await settle();

    expect(onError.mock.calls.map(([error]) => [error.type, ...error.eventIds])).toEqual([
      ["dropped", "page-1"],
      ["dropped", "page-2"],
      ["dropped", "login-1"],
      ["dropped", "login-2"]
    ]);
    expect(sentRequests(fetchMock)[0].body.events.map((event) => event.event_id)).toEqual([
      "deposit-1",
      "deposit-2",
      "deposit-3",
      "deposit-4"
    ]);
  });

  it("keeps delivering when the onError callback throws", async () => {
    configureEvents({
      onError: () => {
        throw new Error("integrator bug");
      }
    });
    fetchMock.mockImplementation(replay("partial", "timer"));

    submitRecorded("partial");
    const withRejections = await flush();
    submitRecorded("timer");
    const next = await flush();

    expect(withRejections).toMatchObject({ acceptedCount: 1, rejectedCount: 2, pendingCount: 0 });
    expect(next).toMatchObject({ acceptedCount: 1, pendingCount: 0 });
  });

  it("resolves an empty flush without a request", async () => {
    await expect(flush()).resolves.toEqual({
      acceptedCount: 0,
      replayedCount: 0,
      rejectedCount: 0,
      pendingCount: 0,
      results: []
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("submitEvent input", () => {
  beforeEach(() => {
    resetEventsForTesting();
    globalThis.fetch = jest.fn<typeof fetch>().mockReturnValue(new Promise<Response>(() => undefined));
  });

  afterEach(() => {
    resetEventsForTesting();
    // @ts-expect-error cleanup of the test-injected global
    delete globalThis.fetch;
  });

  it("requires a monitoring token", () => {
    expect(() => submitEvent({ monitoringToken: "", event: { category: "auth", actionType: "login" } })).toThrow(
      expect.objectContaining({ name: "DiditEventError", type: "invalid_token" })
    );
  });

  it.each([
    [{ category: "auth" }],
    [{ actionType: "login" }],
    [{ category: "auth", actionType: "   " }]
  ])("requires a category and an action type (%p)", (event) => {
    expect(() => submitEvent({ monitoringToken: "valid", event: event as DiditEvent })).toThrow(
      expect.objectContaining({ type: "validation" })
    );
  });

  it("returns the integrator's event id, or a new one per event", () => {
    const event: DiditEvent = { category: "auth", actionType: "login" };

    expect(submitEvent({ monitoringToken: "valid", event: { ...event, eventId: "mine-1" } })).toBe("mine-1");
    const first = submitEvent({ monitoringToken: "valid", event });
    const second = submitEvent({ monitoringToken: "valid", event });
    expect(first).toMatch(/^[\w-]{20,}$/);
    expect(second).not.toBe(first);
  });
});

describe("buildEventRequestBody", () => {
  it("maps the camelCase event onto the snake_case wire contract", () => {
    const body = buildEventRequestBody(
      {
        category: "payment",
        actionType: "deposit_initiated",
        occurredAt: new Date("2026-10-12T08:00:00Z"),
        timeZone: "Europe/Madrid",
        payload: { payment_reference_id: "dep-1", payment_method: "card", status: "pending" },
        customValues: { vip: true },
        session: { sessionId: "web-1", sequence: 4, pageUrl: "https://shop.example/pay", referrer: "https://shop.example/" },
        transactionContext: { amount: "50.00", currency: "EUR", direction: "in", paymentReferenceId: "dep-1" },
        subject: { fullName: "Jane Doe", email: "jane@example.com", phone: "+34600000000", country: "ESP" },
        business: { vendor_data: "biz-1" }
      },
      "evt-1"
    );

    expect(body).toEqual({
      event_id: "evt-1",
      event_category: "payment",
      action_type: "deposit_initiated",
      occurred_at: "2026-10-12T08:00:00.000Z",
      time_zone: "Europe/Madrid",
      subject: { full_name: "Jane Doe", email: "jane@example.com", phone: "+34600000000", country: "ESP" },
      business: { vendor_data: "biz-1" },
      session: { session_id: "web-1", sequence: 4, page_url: "https://shop.example/pay", referrer: "https://shop.example/" },
      transaction_context: { amount: "50.00", currency: "EUR", direction: "in", payment_reference_id: "dep-1" },
      payload: { payment_reference_id: "dep-1", payment_method: "card", status: "pending" },
      custom_values: { vip: true }
    });
  });

  it("produces exactly the session event the service accepted", () => {
    const [recorded] = scenario("scoped").request.events;
    const [event] = recordedEvents("scoped");

    expect(buildEventRequestBody(event, recorded.event_id)).toEqual(recorded);
  });

  it("defaults the time to now and the time zone to the browser's", () => {
    const before = Date.now();
    const body = buildEventRequestBody({ category: "auth", actionType: "logout" }, "evt-2");

    expect(Date.parse(String(body.occurred_at))).toBeGreaterThanOrEqual(before);
    expect(body.time_zone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(body).not.toHaveProperty("subject");
    expect(body).not.toHaveProperty("payload");
  });
});
