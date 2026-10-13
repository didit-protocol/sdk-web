import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// The recorded API is an application's origin, as each application's host is: its key names that origin.
const RECORDED_API = "http://127.0.0.1:4175";
const PUBLISHABLE_KEY = `pk_test_${Buffer.from(RECORDED_API).toString("base64url")}`;
const APP = "http://localhost:4174/e2e/fixtures/app.html";
const PASSWORD = "Correct-horse-battery-91";
const TOKENS = `didit-auth:${RECORDED_API}`;

const fixture = (name) => JSON.parse(readFileSync(new URL(`../src/__tests__/fixtures/${name}.json`, import.meta.url), "utf8"));

async function loadRecording(request, ...scenarios) {
  await request.get(`${RECORDED_API}/__replay/load?scenario=${scenarios.join(",")}`);
}

async function requestsSeen(request) {
  return (await request.get(`${RECORDED_API}/__replay/report`)).json();
}

async function openApp(page, { url = APP, scenario, skip = 0, create = true } = {}) {
  await page.goto(url);
  await page.waitForSelector("body[data-ready='true']", { state: "attached" });
  await page.evaluate(
    ({ scenario, skip, create, key }) => {
      if (scenario) window.didit.seed(scenario, skip);
      if (create) window.didit.create({ publishableKey: key });
    },
    { scenario, skip, create, key: PUBLISHABLE_KEY }
  );
}

const deviceHeaders = (entry) => Object.keys(entry.headers ?? {}).filter((name) => name.startsWith("x-didit-"));

const storedTokens = (tab) => tab.evaluate((key) => JSON.parse(localStorage.getItem(key)), TOKENS);

// Between holdOtherTabs() and deliverOtherTabs(), the tab does not see other tabs' writes to the stored
// tokens (its own still show) and gets their storage events only at the end. WebKit now and then shows a
// tab another tab's write a moment after that tab released the token lock; this makes it happen every
// time. Call before the tab opens a page, so this storage listener runs before the SDK's.
async function delayOtherTabs(tab) {
  await tab.addInitScript((key) => {
    const { getItem, setItem, removeItem } = Storage.prototype;
    let held = null;
    const ours = (storage, name) => held && storage === localStorage && name === key;
    Storage.prototype.getItem = function (name) {
      return ours(this, name) ? held.value : getItem.call(this, name);
    };
    Storage.prototype.setItem = function (name, value) {
      if (ours(this, name)) held.value = value;
      return setItem.call(this, name, value);
    };
    Storage.prototype.removeItem = function (name) {
      if (ours(this, name)) held.value = null;
      return removeItem.call(this, name);
    };
    addEventListener(
      "storage",
      (event) => {
        if (!held || event.key !== key) return;
        event.stopImmediatePropagation();
        held.events.push(event);
      },
      true
    );
    window.holdOtherTabs = () => void (held = { value: getItem.call(localStorage, key), events: [] });
    window.deliverOtherTabs = () => {
      const { events } = held;
      held = null;
      for (const { oldValue, newValue, url } of events) {
        dispatchEvent(new StorageEvent("storage", { key, oldValue, newValue, url, storageArea: localStorage }));
      }
    };
  }, TOKENS);
}

const LATE = " (this tab sees the other tab's write late)";

// The tab is waiting for the token lock, which another tab holds.
const waitsForLock = (tab) => expect.poll(() => tab.evaluate(async () => (await navigator.locks.query()).pending.length)).toBe(1);

// Moves the tab's clock past its access token's expiry and starts a refresh that stays in flight, as on
// a slow network, until the returned route is continued. The tab then holds the token lock.
async function startSlowRefresh(tab) {
  let arrived;
  let held = null;
  const first = new Promise((resolve) => (arrived = resolve));
  await tab.route(`${RECORDED_API}/token/`, (route) => (held ? route.continue() : arrived((held = route))));
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
  expect(await page.evaluate(() => window.opened)).toBe(recorded.signInUrl.replace(recorded.apiBase, RECORDED_API));

  const link = await context.newPage();
  await openApp(link, { url: recorded.callbackUrl });
  const email = await link.evaluate(async () => (await window.auth.handleRedirectCallback()).session.email);
  expect(email).toBe("person@example.com");

  await expect.poll(() => page.evaluate(() => window.didit.events)).toEqual([["SIGNED_IN", "person@example.com"]]);
  expect((await requestsSeen(request)).filter((entry) => entry.mismatch)).toEqual([]);
});

// Holds the tab's PKCE challenge until the returned function runs, so the tab stays between starting a
// hosted sign-in and saving it while another tab does the same. Without the hold, two tabs started at the
// same moment usually overlap there too, but not every time.
async function holdChallenge(tab) {
  await tab.evaluate(() => {
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    const held = new Promise((resolve) => (window.releaseChallenge = resolve));
    crypto.subtle.digest = async (...args) => {
      const result = await digest(...args);
      await held;
      return result;
    };
  });
  return () => tab.evaluate(() => window.releaseChallenge());
}

for (const scenario of ["redirect-two-tabs", "redirect-two-tabs-reversed"]) {
  test(`two tabs starting the hosted sign-in at the same moment both complete (${scenario})`, async ({ context, page, request }) => {
    const recorded = fixture(scenario);
    const [first, second] = recorded.completionOrder;
    const accessToken = (index) => recorded.exchanges[index].response.body.access_token;
    await loadRecording(request, scenario);
    const tabs = [page, await context.newPage()];
    await openApp(tabs[0], { scenario });
    await openApp(tabs[1], { scenario, skip: 48 });

    const release = await holdChallenge(tabs[0]);
    await tabs[0].evaluate(() => void window.auth.signIn());
    await tabs[1].evaluate(() => void window.auth.signIn());
    await tabs[1].waitForURL(/[?&]code=/);
    await release();
    await tabs[0].waitForURL(/[?&]code=/);
    // Each hosted page sent its own person back to the tab that opened it.
    expect(tabs.map((tab) => tab.url())).toEqual(recorded.signIns.map((signIn) => signIn.callbackUrl));

    for (const index of [first, second]) {
      await openApp(tabs[index], { url: tabs[index].url() });
      const session = await tabs[index].evaluate(async () => (await window.auth.handleRedirectCallback()).session);
      expect(session).toMatchObject({ email: recorded.signIns[index].email, sessionId: recorded.signIns[index].sessionId });
    }

    // The tabs share the session completed last; the one it replaced ends at Didit.
    for (const tab of tabs) {
      expect(await storedTokens(tab)).toMatchObject({ accessToken: accessToken(2), sessionId: recorded.signIns[second].sessionId });
    }
    await expect.poll(() => tabs[first].evaluate(() => window.didit.events.at(-1))).toEqual(["SIGNED_IN", recorded.signIns[second].email]);
    const seen = await requestsSeen(request);
    expect(seen.filter((entry) => entry.mismatch)).toEqual([]);
    expect(seen.filter((entry) => entry.body?.grant_type === "authorization_code")).toHaveLength(2);
    expect(seen.filter((entry) => entry.method === "DELETE").map((entry) => entry.headers.authorization)).toEqual([
      `Bearer ${accessToken(0)}`
    ]);
  });
}

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

test(`two tabs near expiry refresh the session once${LATE}`, async ({ context, page, request }) => {
  const recorded = fixture("password-sign-in");
  const refreshed = recorded.exchanges[5].response.body;
  await loadRecording(request, "password-sign-in");
  await openApp(page, { scenario: "password-sign-in" });
  await page.evaluate((password) => window.auth.password.signIn({ email: "person@example.com", password }), PASSWORD);
  const second = await context.newPage();
  await delayOtherTabs(second);
  await openApp(second);
  await second.evaluate(() => window.holdOtherTabs());

  const refresh = await startSlowRefresh(page);
  await second.evaluate(() => {
    window.clockOffset = 5 * 60_000;
    window.refreshed = window.auth.getToken();
  });
  await waitsForLock(second);
  await refresh.continue();

  // A second refresh would present a consumed refresh token, and the API would revoke the session.
  expect(await second.evaluate(() => window.refreshed)).toBe(refreshed.access_token);
  expect(await page.evaluate(() => window.refreshed)).toBe(refreshed.access_token);
  await second.evaluate(() => window.deliverOtherTabs());
  const seen = await requestsSeen(request);
  expect(seen.filter((entry) => entry.body?.grant_type === "refresh_token")).toHaveLength(1);
  expect(seen.filter((entry) => entry.mismatch)).toEqual([]);
  for (const tab of [page, second]) {
    expect(await storedTokens(tab)).toMatchObject({ accessToken: refreshed.access_token });
    await expect.poll(() => tab.evaluate(() => window.didit.events.map(([event]) => event).at(-1))).toBe("TOKEN_REFRESHED");
  }
});

for (const late of [false, true]) {
  test(`a sign-out waits for another tab's refresh, so the refreshed tokens cannot sign the person back in${late ? LATE : ""}`, async ({
    context,
    page,
    request
  }) => {
    const recorded = fixture("password-sign-in");
    const refreshed = recorded.exchanges[5].response.body;
    await loadRecording(request, "password-sign-in");
    if (late) await delayOtherTabs(page);
    await openApp(page, { scenario: "password-sign-in" });
    await page.evaluate((password) => window.auth.password.signIn({ email: "person@example.com", password }), PASSWORD);
    const other = await context.newPage();
    await openApp(other);
    if (late) await page.evaluate(() => window.holdOtherTabs());

    const refresh = await startSlowRefresh(other);
    await page.evaluate(() => void (window.signingOut = window.auth.signOut()));
    await waitsForLock(page);
    // Still waiting for the other tab: signing out now would let its refresh write the session back.
    expect(await storedTokens(page)).toMatchObject({ sessionId: refreshed.session_id });

    await refresh.continue();
    await page.evaluate(() => window.signingOut);
    expect(await other.evaluate(() => window.refreshed)).toBe(refreshed.access_token);
    if (late) await page.evaluate(() => window.deliverOtherTabs());

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

  test(`a sign-in completing during another tab's refresh keeps the new session and ends the old one${late ? LATE : ""}`, async ({
    context,
    page,
    request
  }) => {
    const recorded = fixture("step-up-expired");
    const { access_token: newToken, session_id: newSession } = recorded.exchanges[5].response.body;
    const replaced = recorded.exchanges[7].response.body;
    await loadRecording(request, "step-up-expired");
    if (late) await delayOtherTabs(page);
    await openApp(page, { scenario: "step-up-expired" });
    await page.evaluate((password) => window.auth.password.signIn({ email: "person@example.com", password }), PASSWORD);
    const other = await context.newPage();
    await openApp(other);

    // This tab signs in again on the hosted page and comes back with a code.
    await page.evaluate(() => void window.auth.reauthenticate());
    await page.waitForURL(/[?&]code=/);
    expect(page.url()).toBe(recorded.callbackUrl);
    await openApp(page, { url: page.url() });
    if (late) await page.evaluate(() => window.holdOtherTabs());

    const refresh = await startSlowRefresh(other);
    await page.evaluate(() => void (window.completing = window.auth.handleRedirectCallback()));
    await waitsForLock(page);
    // The new tokens wait for the other tab's refresh, which would otherwise overwrite them.
    expect(await storedTokens(page)).toMatchObject({ sessionId: recorded.sessionBefore });

    await refresh.continue();
    expect(await page.evaluate(async () => (await window.completing).session.sessionId)).toBe(newSession);
    expect(await other.evaluate(() => window.refreshed)).toBe(replaced.access_token);
    if (late) await page.evaluate(() => window.deliverOtherTabs());

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
}

test("with storage per tab, signing out in one tab leaves another tab's session alone", async ({ context, page, request }) => {
  await loadRecording(request, "password-sign-in");
  const tabs = [page, await context.newPage()];
  for (const tab of tabs) {
    await openApp(tab, { scenario: tab === page ? "password-sign-in" : undefined, create: false });
    await tab.evaluate((key) => window.didit.create({ publishableKey: key, storage: "session" }), PUBLISHABLE_KEY);
  }
  await page.evaluate((password) => window.auth.password.signIn({ email: "person@example.com", password }), PASSWORD);
  const signedIn = await page.evaluate((key) => sessionStorage.getItem(key), TOKENS);

  await tabs[1].evaluate(() => window.auth.signOut());

  expect(await page.evaluate((key) => sessionStorage.getItem(key), TOKENS)).toBe(signedIn);
  const seen = await requestsSeen(request);
  expect(seen.filter((entry) => entry.method === "DELETE")).toEqual([]);
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
