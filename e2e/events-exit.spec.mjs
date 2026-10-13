import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const { scenarios } = JSON.parse(
  await readFile(new URL("../packages/signals/src/__tests__/fixtures/device-lane-recordings.json", import.meta.url), "utf8")
);
const recording = scenarios.exit;
const events = recording.request.events.map((event) => ({
  eventId: event.event_id,
  category: event.event_category,
  actionType: event.action_type,
  occurredAt: event.occurred_at,
  timeZone: event.time_zone,
  ...(event.payload && { payload: event.payload }),
  ...(event.session && { session: { sessionId: event.session.session_id, pageUrl: event.session.page_url } })
}));

async function prepare(page, lane, build, collection) {
  await page.goto(`/e2e/fixtures/events.html?build=${build}`);
  await expect(page.locator("body[data-ready=true]")).toBeAttached();
  await page.evaluate(({ lane, collection }) => {
    const digest = crypto.subtle.digest.bind(crypto.subtle);

    window.pendingHashes = 0;
    crypto.subtle.digest = (...args) => {
      window.pendingHashes++;
      return digest(...args).then(async (result) => {
        // A bounded scheduling control, separate from the unforced cold case.
        if (collection === "pending") await new Promise((resolve) => setTimeout(resolve, 2000));
        window.pendingHashes--;
        return result;
      });
    };
    sessionStorage.removeItem("exit-lifecycle");
    const record = (event) => {
      const history = JSON.parse(sessionStorage.getItem("exit-lifecycle") ?? "[]");

      history.push({ type: event.type, persisted: event.persisted, visibility: document.visibilityState, pending: window.pendingHashes });
      sessionStorage.setItem("exit-lifecycle", JSON.stringify(history));
    };
    addEventListener("pagehide", record);
    addEventListener("pageshow", record);
    document.addEventListener("visibilitychange", record);
    window.events.configureEvents({ baseUrl: `/e2e/lane/${lane}`, flushIntervalMs: 60000 });
  }, { lane, collection });
  if (collection === "resolved") await page.evaluate(() => window.events.getDeviceFingerprintPayload());
}

async function received(request, lane) {
  return (await request.get(`/e2e/lane/${lane}/received`)).json();
}

for (const build of ["esm", "umd", "signals-umd"]) {
  for (const collection of ["cold", "resolved", "pending"]) {
    test(`${build}: immediate navigation with ${collection} fingerprint collection`, async ({ page, request }, testInfo) => {
      const lane = `${testInfo.project.name}-${testInfo.testId}`;

      await prepare(page, lane, build, collection);
      await page.evaluate(({ events, token }) => {
        events.forEach((event) => window.events.submitEvent({ monitoringToken: token, event }));
        location.href = "/e2e/fixtures/host.html";
      }, { events, token: recording.token });
      await page.waitForURL("**/e2e/fixtures/host.html");

      // Observe from outside the departed page, before a held digest can finish.
      await expect.poll(async () => (await received(request, lane)).length, { timeout: 1000 }).toBe(1);
      const [sent] = await received(request, lane);
      const lifecycle = await page.evaluate(() => JSON.parse(sessionStorage.getItem("exit-lifecycle")));

      expect(sent.body.events).toEqual(recording.request.events);
      expect(sent.headers["x-monitoring-token"]).toBe(recording.token);
      expect(sent.body.fingerprint_v2.persistentId).toBeTruthy();
      expect(sent.headers["x-didit-pid"]).toBe(sent.body.fingerprint_v2.persistentId);
      expect(sent.body.fingerprint_v2.signals.navigator.userAgent).toBeTruthy();
      expect(lifecycle.some((event) => event.type === "pagehide")).toBe(true);
      if (collection === "pending") expect(lifecycle.find((event) => event.type === "pagehide").pending).toBe(1);
      if (collection === "resolved") expect(sent.body.fingerprint_v2.compositeHash).toBeTruthy();
      testInfo.annotations.push({ type: "pagehide persisted", description: String(lifecycle.find((event) => event.type === "pagehide").persisted) });

      await page.goBack();
      await expect(page.locator("body[data-ready=true]")).toBeAttached();
      expect((await page.evaluate(() => window.events.flush())).pendingCount).toBe(0);
      expect((await received(request, lane)).length).toBe(1);
    });
  }
}

test("closing a page while hashing is pending delivers the queued events", async ({ page: opener, context, request }, testInfo) => {
  const lane = `${testInfo.project.name}-${testInfo.testId}`;

  await opener.goto("/e2e/fixtures/host.html");
  const popup = context.waitForEvent("page");
  await opener.evaluate(() => { window.exitPage = window.open("/e2e/fixtures/events.html"); });
  const page = await popup;
  await prepare(page, lane, "esm", "pending");
  const closed = page.waitForEvent("close");
  await page.evaluate(({ events, token }) => {
    addEventListener("message", (message) => {
      if (message.data !== "leave") return;
      events.forEach((event) => window.events.submitEvent({ monitoringToken: token, event }));
      window.close();
    }, { once: true });
  }, { events, token: recording.token });
  // Trigger from the surviving opener so automation does not await a reply
  // from the browsing context that this action deliberately destroys.
  await opener.evaluate(() => window.exitPage.postMessage("leave", location.origin));
  await closed;

  await expect.poll(async () => (await received(request, lane)).length, { timeout: 1000 }).toBe(1);
  expect((await received(request, lane))[0].body.events).toEqual(recording.request.events);
});

test("return navigation retains delivery without duplicates when back/forward caching is enabled", async ({ playwright, browserName, request }, testInfo) => {
  const browser = await playwright[browserName].launch(browserName === "chromium"
    ? { channel: "chromium", ignoreDefaultArgs: ["--disable-back-forward-cache"] }
    : {});
  const lane = `${testInfo.project.name}-${testInfo.testId}`;

  try {
    // Playwright Test applies the configured context options, baseURL included, to this browser too.
    const page = await browser.newPage();

    await prepare(page, lane, "esm", "pending");
    await page.evaluate(({ events, token }) => {
      events.forEach((event) => window.events.submitEvent({ monitoringToken: token, event }));
      location.href = "/e2e/fixtures/host.html";
    }, { events, token: recording.token });
    await page.waitForURL("**/e2e/fixtures/host.html");
    await expect.poll(async () => (await received(request, lane)).length, { timeout: 1000 }).toBe(1);
    // Restoring a cached document does not fire a new load event.
    await page.goBack({ waitUntil: "commit" });
    await page.waitForFunction(() => window.events && document.visibilityState === "visible");
    const lifecycle = await page.evaluate(() => JSON.parse(sessionStorage.getItem("exit-lifecycle")));
    const hidden = lifecycle.find((event) => event.type === "pagehide");

    expect(hidden.pending).toBe(1);
    if (hidden.persisted) expect(lifecycle.some((event) => event.type === "pageshow" && event.persisted)).toBe(true);
    testInfo.annotations.push({ type: "restored from back/forward cache", description: String(hidden.persisted) });
    await page.evaluate(() => window.events.getDeviceFingerprintPayload());
    expect((await page.evaluate(() => window.events.flush())).pendingCount).toBe(0);
    expect((await received(request, lane)).length).toBe(1);
    expect((await received(request, lane))[0].body.events).toEqual(recording.request.events);
  } finally {
    await browser.close();
  }
});
