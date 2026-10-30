import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const qa = JSON.parse(readFileSync("/tmp/staging-qa.json", "utf8"));
const extra = JSON.parse(readFileSync("/tmp/staging-extra.json", "utf8"));
const API = "https://verification.staging.didit.me";
const SUBJECT = "qa-signals-did-9566";
const KEY = qa.apiKey;
const RUN = `qa-${Date.now()}`;

async function events(request, ids) {
  const rows = await listSubject(request);
  const wanted = new Set(ids);
  const matched = rows.filter((row) => wanted.has(row.event_id));
  const detail = [];
  for (const row of matched) {
    const r = await request.get(`${API}/v3/events/${row.event_uuid}/`, { headers: { "x-api-key": KEY } });
    if (r.ok()) detail.push(await r.json());
  }
  return detail;
}

async function listSubject(request) {
  const r = await request.get(`${API}/v3/events/subjects/${SUBJECT}/?limit=200`, { headers: { "x-api-key": KEY } });
  expect(r.ok()).toBe(true);
  return (await r.json()).results;
}

async function cleanup(request, uuid) {
  await request.delete(`${API}/v3/events/${uuid}/delete/`, { headers: { "x-api-key": KEY } });
}

async function open(page) {
  await page.addInitScript(({ token, run }) => { window.qaToken = token; window.qaRun = run; }, { token: qa.monitoringToken, run: RUN });
  await page.goto("/e2e/fixtures/events.html");
  await expect(page.locator("body[data-ready=true]")).toBeAttached();
  await page.evaluate((baseUrl) => {
    window.errors = [];
    window.events.configureEvents({ baseUrl, onError: (e) => window.errors.push({ type: e.type, ids: e.eventIds }) });
    // Repeat configuration: must not duplicate listeners or reset the queue.
    window.events.configureEvents({ baseUrl });
  }, API);
}

test("page, sign-in and custom events reach the application with stable device and session identity", async ({ page, request }) => {
  await open(page);
  const ids = [`${RUN}-page`, `${RUN}-signup`, `${RUN}-custom`];
  const result = await page.evaluate(async ({ ids }) => {
    const token = window.qaToken;
    const session = { sessionId: `${ids[0]}-session`, pageUrl: "https://shop.example/checkout?step=2" };
    window.events.submitEvent({ monitoringToken: token, event: { eventId: ids[0], category: "session", actionType: "page_view", session, payload: { route: "/checkout" } } });
    window.events.submitEvent({ monitoringToken: token, event: { eventId: ids[1], category: "auth", actionType: "signup", session, payload: { method: "passkey" } } });
    window.events.submitEvent({ monitoringToken: token, event: { eventId: ids[2], category: "custom", actionType: "wishlist_added", session, customValues: { plan: "pro" } } });
    return window.events.flush();
  }, { ids });
  expect(result).toMatchObject({ acceptedCount: 3, rejectedCount: 0, pendingCount: 0 });

  const rows = await events(request, ids);
  expect(rows).toHaveLength(3);
  expect(rows.map((r) => r.session_id)).toEqual([ids[0] + "-session", ids[0] + "-session", ids[0] + "-session"]);
  const pids = new Set(rows.map((r) => r.device_context?.fingerprint_v2?.persistentId ?? r.device_context?.persistent_id));
  expect(pids.size).toBe(1);
  for (const row of rows) await cleanup(request, row.uuid ?? row.event_uuid);
});

test("SPA navigation keeps the session and reports each page", async ({ page, request }) => {
  await open(page);
  const ids = [`${RUN}-spa-1`, `${RUN}-spa-2`];
  const bodies = [];
  await page.route(`${API}/v1/events/batch/`, async (route) => { bodies.push(JSON.parse(route.request().postData())); await route.continue(); });
  await page.evaluate(async ({ ids, base }) => {
    history.pushState({}, "", "/products?page=2");
    const session = { sessionId: `${ids[0]}-s`, sequence: 1, pageUrl: location.href };
    window.events.submitEvent({ monitoringToken: window.qaToken, event: { eventId: ids[0], category: "session", actionType: "page_view", session } });
    history.pushState({}, "", "/cart");
    window.events.submitEvent({ monitoringToken: window.qaToken, event: { eventId: ids[1], category: "session", actionType: "page_view", session: { ...session, sequence: 2, pageUrl: location.href } } });
    await window.events.flush();
  }, { ids, base: API });
  const sent = bodies.flatMap((body) => body.events);
  expect(sent.map((event) => event.session.page_url)).toEqual([
    "http://127.0.0.1:4173/products?page=2",
    "http://127.0.0.1:4173/cart"
  ]);
  expect(sent.map((event) => event.session.sequence)).toEqual([1, 2]);
  const rows = await events(request, ids);
  expect(rows.map((r) => r.session_sequence).sort()).toEqual([1, 2]);
  for (const row of rows) await cleanup(request, row.uuid ?? row.event_uuid);
});

test("a network failure retries the same bytes and the service stores one event", async ({ page, request }) => {
  await open(page);
  const id = `${RUN}-retry`;
  let firstBody;
  await page.route(`${API}/v1/events/batch/`, async (route) => {
    if (!firstBody) { firstBody = route.request().postData(); await route.abort("failed"); return; }
    await route.continue();
  });
  const result = await page.evaluate(async ({ id }) => {
    window.events.submitEvent({ monitoringToken: window.qaToken, event: { eventId: id, category: "auth", actionType: "login", payload: { method: "password" } } });
    const failed = await window.events.flush();
    const retried = await window.events.flush();
    return { failed, retried, sent: window.__sent };
  }, { id });
  expect(result.failed.pendingCount).toBe(1);
  expect(result.retried).toMatchObject({ acceptedCount: 1, pendingCount: 0 });
  const rows = await events(request, [id]);
  expect(rows).toHaveLength(1);
  expect(rows[0].event_id).toBe(id);
  for (const row of rows) await cleanup(request, row.uuid ?? row.event_uuid);
});

test("25 waiting events leave in one request", async ({ page, request }) => {
  await open(page);
  let requests = 0;
  await page.route(`${API}/v1/events/batch/`, async (route) => { requests++; await route.continue(); });
  const result = await page.evaluate(async () => {
    for (let i = 0; i < 25; i++) window.events.submitEvent({ monitoringToken: window.qaToken, event: { eventId: `${window.qaRun}-batch-${i}`, category: "auth", actionType: "login" } });
    return window.events.flush();
  });
  expect(requests).toBe(1);
  expect(result.pendingCount).toBe(0);
  const rows = await listSubject(request);
  for (const row of rows.filter((r) => r.event_id.startsWith(`${RUN}-batch-`))) await cleanup(request, row.event_uuid);
});

test("an expired token, a foreign origin and a used-up token fail safely", async ({ page, request }) => {
  await open(page);
  const result = await page.evaluate(async ({ tokens }) => {
    window.events.submitEvent({ monitoringToken: "unknown-token", event: { eventId: `${window.qaRun}-invalid`, category: "auth", actionType: "login" } });
    const invalid = await window.events.flush();

    window.events.submitEvent({ monitoringToken: tokens.foreign, event: { eventId: `${window.qaRun}-foreign`, category: "auth", actionType: "login" } });
    const foreign = await window.events.flush();

    for (let i = 0; i < 2; i++) window.events.submitEvent({ monitoringToken: tokens.used, event: { eventId: `${window.qaRun}-used-${i}`, category: "auth", actionType: "login" } });
    const used = await window.events.flush();
    return { invalid, foreign, used, errors: window.errors };
  }, { tokens: extra });
  expect(result.invalid).toMatchObject({ acceptedCount: 0, rejectedCount: 1, pendingCount: 0 });
  expect(result.foreign).toMatchObject({ acceptedCount: 0, rejectedCount: 1, pendingCount: 0 });
  expect(result.used.pendingCount).toBe(0);
  expect(result.errors.every((e) => e.type === "invalid_token")).toBe(true);
});

test("the page exit path delivers to the real service before the page is gone", async ({ page, request }) => {
  await open(page);
  const id = `${RUN}-exit`;
  await page.evaluate(({ id }) => {
    window.events.submitEvent({ monitoringToken: window.qaToken, event: { eventId: id, category: "auth", actionType: "logout" } });
    location.href = "/e2e/fixtures/host.html";
  }, { id });
  await page.waitForURL("**/e2e/fixtures/host.html");
  await expect.poll(async () => (await events(request, [id])).length, { timeout: 5000 }).toBe(1);
  const [row] = await events(request, [id]);
  expect(row.event_id).toBe(id);
  await cleanup(request, row.uuid ?? row.event_uuid);
});

test("the credential decides the person even when the event carries another subject, and no secret is sent in the body", async ({ page, request }) => {
  await open(page);
  const id = `${RUN}-subject`;
  let captured;
  await page.route(`${API}/v1/events/batch/`, async (route) => {
    const requestBody = route.request().postData() ?? "";
    captured = { body: requestBody, tokenHeader: route.request().headers()["x-monitoring-token"] };
    await route.continue();
  });
  const result = await page.evaluate(async ({ id }) => {
    window.events.submitEvent({ monitoringToken: window.qaToken, event: { eventId: id, category: "auth", actionType: "login", subject: { vendor_data: "someone-else", email: "attacker@example.test" } } });
    return window.events.flush();
  }, { id });
  expect(result).toMatchObject({ acceptedCount: 1, pendingCount: 0 });
  expect(captured.body).not.toContain(qa.apiKey);
  expect(captured.body).not.toContain(JSON.stringify(qa.monitoringToken).slice(1, -1));
  expect(captured.body).toContain("attacker@example.test");
  const rows = await events(request, [id]);
  expect(rows[0].subject_vendor_data).toBe(SUBJECT);
  for (const row of rows) await cleanup(request, row.uuid ?? row.event_uuid);
});

test("an expired token is classified and dropped without a retry", async ({ page }) => {
  await open(page);
  let requests = 0;
  await page.route(`${API}/v1/events/batch/`, async (route) => { requests++; await route.continue(); });
  const result = await page.evaluate(async ({ token }) => {
    window.events.submitEvent({ monitoringToken: token, event: { eventId: `${window.qaRun}-expired`, category: "auth", actionType: "login" } });
    const first = await window.events.flush();
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { first, errors: window.errors };
  }, { token: extra.short });
  expect(result.first).toMatchObject({ acceptedCount: 0, rejectedCount: 1, pendingCount: 0 });
  expect(result.errors).toEqual([{ type: "expired_token", ids: [`${RUN}-expired`] }]);
  expect(requests).toBe(1);
});
