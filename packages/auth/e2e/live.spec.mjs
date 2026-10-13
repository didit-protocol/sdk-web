// The SDK against a running Didit auth service: the real hosted page, token
// rotation, passkeys with a virtual authenticator, an emailed code, step-ups and
// bot protection.
//
//   DIDIT_AUTH_LIVE_UPSTREAM=http://127.0.0.1:8765   the service, run with CUSTOMER_AUTH_ZONE_ORIGIN=http://auth.localhost:8766
//                                                     (port 8766 proxies to it with the host unchanged)
//   DIDIT_AUTH_LIVE_PUBLISHABLE_KEY=pk_test_...       the key the console shows for a Sandbox application with
//                                                     password, code and passkey on, agents on,
//                                                     http://localhost:4174 allowed, and
//                                                     /e2e/fixtures/app.html on http://localhost:4174 and on
//                                                     the application's own host registered as redirects
//   DIDIT_AUTH_LIVE_AGENT=<agent client id>           an agent client with redirect http://localhost:4174/agent-callback
//   DIDIT_AUTH_LIVE_MAILBOX=<file>                    where that local service writes outgoing email (JSON lines)
//   DIDIT_AUTH_LIVE_PASSWORD=<password>               the password of the identities used below
//   DIDIT_AUTH_LIVE_VERIFICATION=<origin>             verification's hosted sessions, when it is the service's own
//                                                     stand-in (tests/authentication/verification_service.py), and
//                                                     the application has a step-up rule for contact changes
//   DIDIT_AUTH_LIVE_PROTECTION=1                      the application's bot protection challenges brute force
//
//   npx playwright test --project=live
import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const {
  DIDIT_AUTH_LIVE_UPSTREAM,
  DIDIT_AUTH_LIVE_PUBLISHABLE_KEY,
  DIDIT_AUTH_LIVE_AGENT,
  DIDIT_AUTH_LIVE_MAILBOX,
  DIDIT_AUTH_LIVE_PASSWORD,
  DIDIT_AUTH_LIVE_VERIFICATION,
  DIDIT_AUTH_LIVE_PROTECTION
} = process.env;
const PUBLISHABLE_KEY = DIDIT_AUTH_LIVE_PUBLISHABLE_KEY ?? "";
// The application's own host: its hosted pages, its runtime API and its issuer.
const AUTH_ORIGIN = PUBLISHABLE_KEY && Buffer.from(PUBLISHABLE_KEY.slice("pk_test_".length), "base64url").toString();
const APP = "http://localhost:4174/e2e/fixtures/app.html";
const SAME_ORIGIN_APP = `${AUTH_ORIGIN}/e2e/fixtures/app.html`;
const WRONG_PASSWORD = "Not-the-password-0000";

test.skip(!DIDIT_AUTH_LIVE_UPSTREAM || !PUBLISHABLE_KEY, "needs a running Didit auth service");

async function openApp(page, url = APP) {
  await page.goto(url);
  await page.waitForSelector("body[data-ready='true']", { state: "attached" });
  await page.evaluate((key) => window.didit.create({ publishableKey: key }), PUBLISHABLE_KEY);
}

function watchRequests(page) {
  const seen = [];
  page.on("request", (request) => {
    if (request.url().startsWith(`${AUTH_ORIGIN}/`) && ["fetch", "xhr"].includes(request.resourceType())) {
      seen.push({ method: request.method(), path: request.url().slice(AUTH_ORIGIN.length + 1), body: request.postData(), headers: request.headers() });
    }
  });
  return seen;
}

// Calls the runtime API from a page of its own, next to `page`: this machine's browsers resolve
// *.localhost, Node does not.
async function callApi(page, path, init = {}) {
  const caller = await page.context().newPage();
  try {
    await caller.goto(APP);
    return await caller.evaluate(
      async ([url, init]) => {
        const response = await fetch(url, { ...init, credentials: "omit" });
        return { status: response.status, body: await response.json().catch(() => null) };
      },
      [`${AUTH_ORIGIN}/${path}`, init]
    );
  } finally {
    await caller.close();
  }
}

function lastEmailedCode(email) {
  const mail = readFileSync(DIDIT_AUTH_LIVE_MAILBOX, "utf8").trim().split("\n").map(JSON.parse).filter((m) => m.to === email).at(-1);
  const [, left, right] = />(\d{3}) (\d{3})</.exec(mail.html);
  return left + right;
}

const passwordSignIn = (page, email) =>
  page.evaluate(
    ([email, password]) => window.auth.password.signIn({ email, password }).then((result) => result.status),
    [email, DIDIT_AUTH_LIVE_PASSWORD]
  );

test("signs in on the real hosted page, refreshes, and signs out at Didit", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => void window.auth.signIn({ returnTo: "/account" }));
  await page.waitForURL(`${AUTH_ORIGIN}/sign-in/**`);
  await page.getByLabel("Email address").fill("browser-person@example.com");
  await page.getByLabel("Password", { exact: true }).fill(DIDIT_AUTH_LIVE_PASSWORD);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL(/\/e2e\/fixtures\/app\.html\?code=/);

  await openApp(page, page.url());
  const signedIn = await page.evaluate(async () => {
    const { session, returnTo } = await window.auth.handleRedirectCallback();
    return { email: session.email, methods: session.methods, returnTo, href: location.href };
  });
  expect(signedIn).toEqual({ email: "browser-person@example.com", methods: ["password"], returnTo: "/account", href: APP });

  const first = await page.evaluate(() => window.auth.getToken());
  await page.evaluate(() => void (window.clockOffset = 5 * 60_000));
  const second = await page.evaluate(() => window.auth.getToken());
  expect(second).not.toBe(first);
  expect((await page.evaluate(() => window.auth.getSession({ force: true })))?.email).toBe("browser-person@example.com");

  await page.evaluate(() => window.auth.signOut());
  expect(await page.evaluate(() => window.auth.getSession())).toBeNull();
  const revoked = await callApi(page, "session/", { headers: { Authorization: `Bearer ${second}` } });
  expect(revoked.status).toBe(401);
  expect(await page.evaluate(() => window.didit.events.map(([event]) => event))).toEqual([
    "SIGNED_IN",
    "TOKEN_REFRESHED",
    "SIGNED_OUT"
  ]);
});

for (const order of [
  [0, 1],
  [1, 0]
]) {
  test(`two tabs sign in on the real hosted page at the same moment (tab ${order[0] + 1} completes first)`, async ({ context, page }) => {
    const people = ["browser-person@example.com", "second-browser-person@example.com"];
    const tabs = [page, await context.newPage()];
    // A browser that has seen the hosted page before, here through a sign-in it abandoned. (The hosted page
    // sets its CSRF cookie on the first visit, so two first visits at the same moment replace each other's.)
    await openApp(page);
    await page.evaluate(() => void window.auth.signIn());
    await page.waitForURL(`${AUTH_ORIGIN}/sign-in/**`);
    for (const tab of tabs) await openApp(tab);

    // Both tabs leave for the hosted page at once, as tabs a browser restores together do when signed out.
    await Promise.all(tabs.map((tab) => tab.evaluate(() => void window.auth.signIn())));
    for (const [index, tab] of tabs.entries()) {
      await tab.waitForURL(`${AUTH_ORIGIN}/sign-in/**`);
      await tab.getByLabel("Email address").fill(people[index]);
      await tab.getByLabel("Password", { exact: true }).fill(DIDIT_AUTH_LIVE_PASSWORD);
      await tab.getByRole("button", { name: "Continue", exact: true }).click();
      await tab.waitForURL(/\/e2e\/fixtures\/app\.html\?code=/);
    }

    const tokens = [];
    for (const index of order) {
      await openApp(tabs[index], tabs[index].url());
      const session = await tabs[index].evaluate(async () => (await window.auth.handleRedirectCallback()).session);
      expect(session.email).toBe(people[index]);
      tokens[index] = await tabs[index].evaluate(() => window.auth.getToken());
    }
    // The tabs share the session completed last; the one it replaced was ended at Didit.
    const replaced = await callApi(page, "session/", { headers: { Authorization: `Bearer ${tokens[order[0]]}` } });
    expect(replaced.status).toBe(401);
    for (const tab of tabs) {
      expect((await tab.evaluate(() => window.auth.getSession({ force: true })))?.email).toBe(people[order[1]]);
    }
    await page.evaluate(() => window.auth.signOut());
  });
}

test("two tabs refresh once and the session survives (the API revokes it on refresh-token reuse)", async ({ context, page }) => {
  const seen = watchRequests(page);
  await openApp(page);
  expect(await passwordSignIn(page, "browser-person@example.com")).toBe("signed_in");
  const other = await context.newPage();
  const seenOther = watchRequests(other);
  await openApp(other);

  for (const tab of [page, other]) await tab.evaluate(() => void (window.clockOffset = 5 * 60_000));
  const [a, b] = await Promise.all([page, other].map((tab) => tab.evaluate(() => window.auth.getToken())));

  expect(a).toBe(b);
  const refreshes = [...seen, ...seenOther].filter((entry) => entry.path === "token/" && entry.body?.includes("refresh_token"));
  expect(refreshes).toHaveLength(1);
  for (const tab of [page, other]) {
    expect((await tab.evaluate(() => window.auth.getSession({ force: true })))?.email).toBe("browser-person@example.com");
  }
  await page.evaluate(() => window.auth.signOut());
});

test("signs in with an emailed code from another origin", async ({ page }) => {
  test.skip(!DIDIT_AUTH_LIVE_MAILBOX, "needs the local mailbox");
  await openApp(page);

  expect(await page.evaluate(() => window.auth.emailCode.start({ email: "browser-person@example.com" }))).toEqual({
    status: "code_sent",
    expiresIn: 600
  });
  const result = await page.evaluate((code) => window.auth.emailCode.verify({ code }), lastEmailedCode("browser-person@example.com"));

  expect(result.status).toBe("signed_in");
  expect(result.session.methods).toEqual(["code"]);
  await page.evaluate(() => window.auth.signOut());
});

test("registers a passkey, signs in and reauthenticates with it, then approves an agent", async ({ context, page }) => {
  const seen = watchRequests(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true }
  });
  // Passkeys are bound to the auth domain, so this page shares its origin.
  await openApp(page, SAME_ORIGIN_APP);

  expect(await passwordSignIn(page, "passkey-person@example.com")).toBe("signed_in");
  const registered = await page.evaluate(() => window.auth.passkeys.register());
  expect(registered.id).toBeTruthy();
  await page.evaluate(() => window.auth.signOut());

  const signedIn = await page.evaluate(() => window.auth.passkeys.signIn());
  expect(signedIn.status).toBe("signed_in");
  expect(signedIn.session).toMatchObject({ email: "passkey-person@example.com", methods: ["passkey"], mfaVerified: true });
  const again = await page.evaluate(() => window.auth.reauthenticate({ method: "passkey" }));
  expect(again.userId).toBe(signedIn.session.userId);
  expect(again.sessionId).not.toBe(signedIn.session.sessionId);

  if (DIDIT_AUTH_LIVE_AGENT) {
    // The application's policy approves agents only from a passkey session, which this now is.
    const verifier = "live-agent-verifier-0123456789012345678901234567890";
    const pending = await callApi(page, "agents/request/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: DIDIT_AUTH_LIVE_AGENT,
        scopes: ["read"],
        redirect_uri: "http://localhost:4174/agent-callback",
        state: "live-agent",
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256"
      })
    });
    const { challenge } = pending.body;
    const consent = await page.evaluate((challenge) => window.auth.agents.consent({ challenge, decision: "approve" }), challenge);
    expect(consent.status).toBe("approved");
    expect(new URL(consent.redirectTo).searchParams.get("state")).toBe("live-agent");
  }

  // Same origin, so every request carried the device headers, and the API accepted them.
  expect(seen.length).toBeGreaterThan(5);
  for (const entry of seen) expect(entry.headers["x-didit-pid"]).toMatch(/^[A-Za-z0-9_-]{20,32}$/);
  await page.evaluate(() => window.auth.signOut());
});

test("steps up before a contact change: the hosted check, verification and Didit's record", async ({ page }) => {
  test.skip(!DIDIT_AUTH_LIVE_VERIFICATION, "needs a contact-change step-up rule and verification's stand-in");
  await openApp(page);
  expect(await passwordSignIn(page, "browser-person@example.com")).toBe("signed_in");

  // No payout rule: the action goes ahead without a check.
  expect(await page.evaluate(() => window.auth.stepUp({ action: "payout", amount: "900.00", currency: "USD" }))).toMatchObject({
    status: "not_required",
    approved: true
  });
  await page.evaluate(() => void window.auth.stepUp({ action: "contact" }));
  await page.waitForURL(`${AUTH_ORIGIN}/verify/**`);
  await page.locator("form button").click();
  await page.waitForURL(`${DIDIT_AUTH_LIVE_VERIFICATION}/session/**`);
  await page.getByRole("link", { name: "approve" }).click();
  await page.waitForURL(/[?&]step_up=/);

  await openApp(page, page.url());
  const outcome = await page.evaluate(async () => ({ ...(await window.auth.handleStepUpCallback()), href: location.href }));
  expect(outcome).toMatchObject({ status: "approved", approved: true, rule: "contact", href: APP });
  await page.evaluate(() => window.auth.signOut());
});

test("answers bot protection with an emailed code, then with a passkey", async ({ context, page }) => {
  test.skip(!DIDIT_AUTH_LIVE_PROTECTION || !DIDIT_AUTH_LIVE_MAILBOX, "needs brute-force protection set to challenge and the mailbox");
  const email = "protected-browser-person@example.com";
  const failFiveTimes = async () => {
    for (let attempt = 0; attempt < 5; attempt++) expect(await passwordSignIn(page, email, WRONG_PASSWORD)).toBeUndefined();
  };
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true }
  });
  await openApp(page, SAME_ORIGIN_APP);

  await failFiveTimes();
  expect(await page.evaluate(([email, password]) => window.auth.password.signIn({ email, password }), [email, DIDIT_AUTH_LIVE_PASSWORD])).toEqual({
    status: "protection_required",
    methods: ["email_code"],
    expiresIn: 300
  });
  const byCode = await page.evaluate((code) => window.auth.protection.verify({ code }), lastEmailedCode(email));
  expect(byCode.status).toBe("signed_in");
  await page.evaluate(() => window.auth.passkeys.register());
  await page.evaluate(() => window.auth.signOut());

  await failFiveTimes();
  expect(
    await page.evaluate(([email, password]) => window.auth.password.signIn({ email, password }), [email, DIDIT_AUTH_LIVE_PASSWORD])
  ).toMatchObject({ status: "protection_required", methods: ["passkey", "email_code"] });
  const byPasskey = await page.evaluate(() => window.auth.protection.passkey());
  expect(byPasskey.status).toBe("signed_in");
  expect(byPasskey.session).toMatchObject({ email, mfaVerified: true });
  await page.evaluate(() => window.auth.signOut());
});
