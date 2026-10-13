import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

// Real answers of the Didit verification API to POST /v1/events/batch/; the
// fixture server replays the one recorded for exactly the token and events sent.
const { scenarios } = JSON.parse(
  await readFile(new URL("../packages/signals/src/__tests__/fixtures/device-lane-recordings.json", import.meta.url), "utf8")
);

/** The recorded events, as an integrator passes them to submitEvent. */
function eventsOf(name) {
  return scenarios[name].request.events.map((event) => ({
    eventId: event.event_id,
    category: event.event_category,
    actionType: event.action_type,
    occurredAt: event.occurred_at,
    timeZone: event.time_zone,
    ...(event.payload && { payload: event.payload }),
    ...(event.session && { session: { sessionId: event.session.session_id, pageUrl: event.session.page_url } })
  }));
}

function laneFor(testInfo) {
  return `${testInfo.project.name}-${testInfo.testId}-${testInfo.retry}`;
}

async function open(page, lane, build = "esm") {
  await page.goto(`/e2e/fixtures/events.html?build=${build}`);
  await expect(page.locator("body[data-ready=true]")).toBeAttached();
  await page.evaluate((baseUrl) => {
    window.errors = [];
    window.events.configureEvents({
      baseUrl,
      onError: (error) => window.errors.push({ type: error.type, eventIds: error.eventIds })
    });
  }, `/e2e/lane/${lane}`);
}

function submit(page, name, monitoringToken = scenarios[name].token) {
  return page.evaluate(
    ({ events, monitoringToken }) => events.map((event) => window.events.submitEvent({ monitoringToken, event })),
    { events: eventsOf(name), monitoringToken }
  );
}

async function received(request, lane) {
  return (await request.get(`/e2e/lane/${lane}/received`)).json();
}

function flushInPage(page) {
  return page.evaluate(async () => {
    const result = await window.events.flush();
    return {
      ...result,
      results: result.results.map(({ error, ...item }) => ({
        ...item,
        errorType: error?.type,
        typedError: error ? error instanceof window.events.DiditEventError : undefined
      }))
    };
  });
}

test.describe("submitEvent in a real browser", () => {
  test("sends 25 waiting events in one batch with the token and the device fingerprint", async ({ page, request }, testInfo) => {
    const lane = laneFor(testInfo);
    await open(page, lane);

    const ids = await submit(page, "batch_of_25");

    await expect.poll(async () => (await received(request, lane)).length).toBe(1);
    const [sent] = await received(request, lane);
    expect(sent.headers["x-monitoring-token"]).toBe("valid");
    expect(sent.headers["content-type"]).toBe("application/json");
    expect(sent.body.fingerprint_v2.schema).toBe("didit-fp-v2");
    expect(sent.headers["x-didit-pid"]).toBe(sent.body.fingerprint_v2.persistentId);
    expect(sent.headers["x-didit-fp-hash"]).toBe(sent.body.fingerprint_v2.compositeHash);
    expect(sent.body.events).toEqual(scenarios.batch_of_25.request.events);
    expect(ids).toEqual(scenarios.batch_of_25.request.events.map((event) => event.event_id));
    expect(await flushInPage(page)).toMatchObject({ pendingCount: 0 });
  });

  test("sends a waiting event once five seconds have passed", async ({ page, request }, testInfo) => {
    const lane = laneFor(testInfo);
    await page.clock.install();
    await open(page, lane);

    await submit(page, "timer");
    await page.clock.runFor(4900);
    expect(await received(request, lane)).toEqual([]);

    await page.clock.runFor(100);
    await expect.poll(async () => (await received(request, lane)).length).toBe(1);
    expect((await received(request, lane))[0].body.events).toEqual(scenarios.timer.request.events);
  });

  test("delivers what is still waiting when the user leaves the page", async ({ page, request }, testInfo) => {
    const lane = laneFor(testInfo);
    await open(page, lane);

    await submit(page, "exit");
    await page.goto("about:blank");

    // Well before the 5 second timer, which left with the page anyway.
    await expect.poll(async () => (await received(request, lane)).length, { timeout: 3000 }).toBe(1);
    expect((await received(request, lane))[0].body.events).toEqual(scenarios.exit.request.events);
  });

  test("resolves flush with every event's outcome and typed errors", async ({ page }, testInfo) => {
    await open(page, laneFor(testInfo));

    await submit(page, "partial");
    const result = await flushInPage(page);

    expect(result).toMatchObject({ acceptedCount: 1, rejectedCount: 2, pendingCount: 0 });
    expect(result.results).toEqual([
      expect.objectContaining({ eventId: "rec-logout-1", outcome: "accepted", status: "ACCEPTED" }),
      expect.objectContaining({ eventId: "rec-deposit-1", outcome: "rejected", errorType: "validation", typedError: true }),
      expect.objectContaining({ eventId: "rec-login-1", outcome: "rejected", errorType: "validation", typedError: true })
    ]);
    expect(await page.evaluate(() => window.errors)).toEqual([
      { type: "validation", eventIds: ["rec-deposit-1"] },
      { type: "validation", eventIds: ["rec-login-1"] }
    ]);
  });

  test("reports a refused token through onError and drops the events", async ({ page }, testInfo) => {
    await open(page, laneFor(testInfo));

    const ids = await submit(page, "expired_token");
    const result = await flushInPage(page);

    expect(result).toMatchObject({ acceptedCount: 0, rejectedCount: 1, pendingCount: 0 });
    expect(await page.evaluate(() => window.errors)).toEqual([{ type: "expired_token", eventIds: ids }]);
  });

  for (const build of ["umd", "signals-umd"]) {
    test(`works from the ${build} script-tag build`, async ({ page, request }, testInfo) => {
      const lane = laneFor(testInfo);
      await open(page, lane, build);

      await submit(page, "timer");
      const result = await flushInPage(page);

      expect(result).toMatchObject({ acceptedCount: 1, pendingCount: 0 });
      expect((await received(request, lane))[0].body.events).toEqual(scenarios.timer.request.events);
    });
  }
});
