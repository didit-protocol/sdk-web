import { expect, test } from "@playwright/test";

// Against a real Didit verification API directly from the browser. This
// exercises preflight and Origin-bound credentials as well as ingestion:
//
//   EVENTS_UPSTREAM=<API base URL> EVENTS_MONITORING_TOKEN=<token from POST /v3/events/sdk-token/> \
//     npx playwright test e2e/events-live.spec.mjs --project=chromium
//
// The token needs `auth` in its categories (or none), at least 6 uses, and
// must permit the fixture origin http://127.0.0.1:4173 when Origin-bound.
const { EVENTS_UPSTREAM, EVENTS_MONITORING_TOKEN } = process.env;

test.skip(!EVENTS_UPSTREAM || !EVENTS_MONITORING_TOKEN, "needs EVENTS_UPSTREAM and EVENTS_MONITORING_TOKEN");

test("stores sign-up, login and logout events, and a resend is a replay", async ({ page }) => {
  await page.goto("/e2e/fixtures/events.html");
  await expect(page.locator("body[data-ready=true]")).toBeAttached();
  const run = `live-${Date.now()}`;
  // Fixed once: a resend only counts as a replay when every hashed field, the time included, is equal.
  const occurredAt = new Date().toISOString();

  const send = () =>
    page.evaluate(
      async ({ monitoringToken, run, occurredAt, baseUrl }) => {
        window.events.configureEvents({ baseUrl });
        for (const actionType of ["signup", "login", "logout"]) {
          window.events.submitEvent({
            monitoringToken,
            event: { eventId: `${run}-${actionType}`, category: "auth", actionType, occurredAt }
          });
        }
        const { results, ...counts } = await window.events.flush();
        return { ...counts, outcomes: results.map((result) => result.outcome) };
      },
      { monitoringToken: EVENTS_MONITORING_TOKEN, run, occurredAt, baseUrl: EVENTS_UPSTREAM }
    );

  expect(await send()).toEqual({
    acceptedCount: 3,
    replayedCount: 0,
    rejectedCount: 0,
    pendingCount: 0,
    outcomes: ["accepted", "accepted", "accepted"]
  });
  expect(await send()).toMatchObject({ acceptedCount: 0, replayedCount: 3, outcomes: ["replayed", "replayed", "replayed"] });
});
