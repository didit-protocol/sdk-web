import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const APPLICATION_ID = "b83c95f9-93bd-4bed-a94f-f4b354a446db";
const RECORDED_API = "http://127.0.0.1:4175";
const API_BASE = `${RECORDED_API}/auth/v2/authentication/${APPLICATION_ID}`;
const PUBLISHABLE_KEY = `pk_test_${Buffer.from(API_BASE).toString("base64url")}`;
const APP = "http://localhost:4174/e2e/fixtures/app.html";
const PASSWORD = "Correct-horse-battery-91";
const TOKENS = `didit-auth:${APPLICATION_ID}`;

const fixture = (name) => JSON.parse(readFileSync(new URL(`../src/__tests__/fixtures/${name}.json`, import.meta.url), "utf8"));

async function loadRecording(request, ...scenarios) {
  await request.get(`${RECORDED_API}/__replay/load?scenario=${scenarios.join(",")}`);
}

async function requestsSeen(request) {
  return (await request.get(`${RECORDED_API}/__replay/report`)).json();
}

async function openApp(page, { url = APP, scenario, create = true } = {}) {
  await page.goto(url);
  await page.waitForSelector("body[data-ready='true']", { state: "attached" });
  await page.evaluate(
    ({ scenario, create, key }) => {
      if (scenario) window.didit.seed(scenario);
      if (create) window.didit.create({ publishableKey: key });
    },
    { scenario, create, key: PUBLISHABLE_KEY }
  );
}

const deviceHeaders = (entry) => Object.keys(entry.headers ?? {}).filter((name) => name.startsWith("x-didit-"));

const storedTokens = (tab) => tab.evaluate((key) => JSON.parse(localStorage.getItem(key)), TOKENS);

// Moves the tab's clock past its access token's expiry and starts a refresh that stays in flight, as on
// a slow network, until the returned route is continued. The tab then holds the token lock.
async function startSlowRefresh(tab) {
  let arrived;
  let held = null;
  const first = new Promise((resolve) => (arrived = resolve));
  await tab.route(`${API_BASE}/token/`, (route) => (held ? route.continue() : arrived((held = route))));
  await tab.evaluate(() => {
    window.clockOffset = 5 * 60_000;
    window.refreshed = window.auth.getToken();
  });
  const route = await first;
  // The tokens the refresh brings back are then fresh for both tabs.
  await tab.evaluate(() => void (window.clockOffset = 0));
  return route;
}

test("signs in on the hosted page and completes on the redirect page", async ({ page, request }) => {
  const recorded = fixture("redirect-sign-in");
  await loadRecording(request, "redirect-sign-in");
  await openApp(page, { scenario: "redirect-sign-in" });

  await page.evaluate(() => void window.auth.signIn({ returnTo: "/account" }));
  await page.waitForURL(/[?&]code=/);
  expect(page.url()).toBe(recorded.callbackUrl);

  await openApp(page, { url: page.url() });
  const result = await page.evaluate(async () => {
    const { session, returnTo } = await window.auth.handleRedirectCallback();
    return { email: session.email, returnTo, href: location.href, events: window.didit.events };
  });

  expect(result).toEqual({
    email: "person@example.com",
    returnTo: "/account",
    href: APP,
    events: [["SIGNED_IN", "person@example.com"]]
  });
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).sessionId, TOKENS)).toBe(
    recorded.exchanges[1].response.body.sid
  );
  const seen = await requestsSeen(request);
  expect(seen.map(({ method, path }) => `${method} ${path}`)).toEqual(["GET sign-in/", "POST token/", "GET session/"]);
  expect(seen.filter((entry) => entry.mismatch)).toEqual([]);
  // Cross-origin, the API only allows Authorization and Content-Type: no device headers by default.
  expect(seen.flatMap(deviceHeaders)).toEqual([]);
});

test("completes in another tab, as an emailed magic link does, and the first tab follows", async ({ context, page, request }) => {
  const recorded = fixture("redirect-sign-in");
  await loadRecording(request, "redirect-sign-in");
  await openApp(page, { scenario: "redirect-sign-in", create: false });
  await page.evaluate((key) => {
    // The person asked for a link and waits on this tab: nothing navigates.
    window.auth = window.didit.createDiditAuth({ publishableKey: key, navigate: (url) => void (window.opened = url) });
    window.auth.onAuthStateChange((event, session) => window.didit.events.push([event, session && session.email]));
    return window.auth.signIn();
  }, PUBLISHABLE_KEY);
  // The same address the recording opened, on this test's API host.
  expect(await page.evaluate(() => window.opened)).toBe(recorded.signInUrl.replace("http://127.0.0.1:8765", RECORDED_API));

  const link = await context.newPage();
  await openApp(link, { url: recorded.callbackUrl });
  const email = await link.evaluate(async () => (await window.auth.handleRedirectCallback()).session.email);
  expect(email).toBe("person@example.com");

  await expect.poll(() => page.evaluate(() => window.didit.events)).toEqual([["SIGNED_IN", "person@example.com"]]);
  expect((await requestsSeen(request)).filter((entry) => entry.mismatch)).toEqual([]);
});

test("two tabs near expiry refresh the session once", async ({ context, page, request }) => {
  const recorded = fixture("password-sign-in");
  await loadRecording(request, "password-sign-in");
  await openApp(page, { scenario: "password-sign-in" });
  expect(
    await page.evaluate((password) => window.auth.password.signIn({ email: "person@example.com", password }).then((r) => r.status), PASSWORD)
  ).toBe("signed_in");
  const second = await context.newPage();
  await openApp(second);

  for (const tab of [page, second]) await tab.evaluate(() => void (window.clockOffset = 5 * 60_000));
  const tokens = await Promise.all([page, second].map((tab) => tab.evaluate(() => window.auth.getToken())));

  // A second refresh would present a consumed refresh token, and the API would revoke the session.
  expect(tokens).toEqual([recorded.exchanges[5].response.body.access_token, recorded.exchanges[5].response.body.access_token]);
  const seen = await requestsSeen(request);
  expect(seen.filter((entry) => entry.body?.grant_type === "refresh_token")).toHaveLength(1);
  expect(seen.filter((entry) => entry.mismatch)).toEqual([]);
  for (const tab of [page, second]) {
    await expect.poll(() => tab.evaluate(() => window.didit.events.map(([event]) => event).at(-1))).toBe("TOKEN_REFRESHED");
  }
});

test("a sign-out waits for another tab's refresh, so the refreshed tokens cannot sign the person back in", async ({
  context,
  page,
  request
}) => {
  const recorded = fixture("password-sign-in");
  const refreshed = recorded.exchanges[5].response.body;
  await loadRecording(request, "password-sign-in");
  await openApp(page, { scenario: "password-sign-in" });
  await page.evaluate((password) => window.auth.password.signIn({ email: "person@example.com", password }), PASSWORD);
  const other = await context.newPage();
  await openApp(other);

  const refresh = await startSlowRefresh(other);
  await page.evaluate(() => void (window.signingOut = window.auth.signOut()));
  await page.waitForTimeout(300);
  // Still waiting for the other tab: signing out now would let its refresh write the session back.
  expect(await storedTokens(page)).toMatchObject({ sessionId: refreshed.session_id });

  await refresh.continue();
  await page.evaluate(() => window.signingOut);
  expect(await other.evaluate(() => window.refreshed)).toBe(refreshed.access_token);

  for (const tab of [page, other]) {
    expect(await storedTokens(tab)).toBeNull();
    expect(await tab.evaluate(() => window.auth.getSession())).toBeNull();
    await expect.poll(() => tab.evaluate(() => window.didit.events.at(-1))).toEqual(["SIGNED_OUT", null]);
  }
  // The session ends at Didit with the refreshed access token: the replaced one no longer works there.
  const seen = await requestsSeen(request);
  expect(seen.filter((entry) => entry.method === "DELETE").map((entry) => entry.headers.authorization)).toEqual([
    `Bearer ${refreshed.access_token}`
  ]);
  expect(seen.filter((entry) => entry.body?.grant_type === "refresh_token")).toHaveLength(1);
  expect(seen.filter((entry) => entry.mismatch)).toEqual([]);
});

test("a sign-in completing during another tab's refresh keeps the new session and ends the old one", async ({
  context,
  page,
  request
}) => {
  const recorded = fixture("step-up-expired");
  const { access_token: newToken, session_id: newSession } = recorded.exchanges[5].response.body;
  const replaced = recorded.exchanges[7].response.body;
  await loadRecording(request, "step-up-expired");
  await openApp(page, { scenario: "step-up-expired" });
  await page.evaluate((password) => window.auth.password.signIn({ email: "person@example.com", password }), PASSWORD);
  const other = await context.newPage();
  await openApp(other);

  // This tab steps up on the hosted page and comes back with a code.
  await page.evaluate(() => void window.auth.stepUp());
  await page.waitForURL(/[?&]code=/);
  expect(page.url()).toBe(recorded.callbackUrl);
  await openApp(page, { url: page.url() });

  const refresh = await startSlowRefresh(other);
  await page.evaluate(() => void (window.completing = window.auth.handleRedirectCallback()));
  await expect
    .poll(async () => (await requestsSeen(request)).some((entry) => entry.headers?.authorization === `Bearer ${newToken}`))
    .toBe(true);
  await page.waitForTimeout(300);
  // The new tokens wait for the other tab's refresh, which would otherwise overwrite them.
  expect(await storedTokens(page)).toMatchObject({ sessionId: recorded.sessionBefore });

  await refresh.continue();
  expect(await page.evaluate(async () => (await window.completing).session.sessionId)).toBe(newSession);
  expect(await other.evaluate(() => window.refreshed)).toBe(replaced.access_token);

  for (const tab of [page, other]) {
    expect(await storedTokens(tab)).toMatchObject({ accessToken: newToken, sessionId: newSession });
    await expect.poll(() => tab.evaluate(() => window.didit.events.at(-1))).toEqual(["SIGNED_IN", "person@example.com"]);
  }
  // The replaced session ends at Didit with the access token the other tab's refresh brought back.
  const seen = await requestsSeen(request);
  expect(seen.filter((entry) => entry.method === "DELETE").map((entry) => entry.headers.authorization)).toEqual([
    `Bearer ${replaced.access_token}`
  ]);
  expect(seen.filter((entry) => entry.body?.grant_type === "refresh_token")).toHaveLength(1);
  expect(seen.filter((entry) => entry.mismatch)).toEqual([]);
});

test("sends device signals when the page and the API share an origin", async ({ page, request }) => {
  await loadRecording(request, "password-reset");
  await openApp(page, { url: `${RECORDED_API}/e2e/fixtures/app.html` });

  expect(await page.evaluate(() => window.auth.password.requestReset({ email: "person@example.com" }))).toEqual({ expiresIn: 1800 });
  const [reset] = await requestsSeen(request);
  expect(reset.mismatch).toBeUndefined();
  expect(reset.headers["x-didit-fp-v2"]).toBe("1");
  expect(reset.headers["x-didit-pid"]).toMatch(/^[A-Za-z0-9_-]{20,32}$/);
  expect(reset.headers["x-didit-fp-hash"]).toBeTruthy();
  expect(await page.evaluate(() => localStorage.getItem("didit-pid-v1"))).toBe(reset.headers["x-didit-pid"]);
});
