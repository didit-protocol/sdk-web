import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// The core package's remaining journeys in the independent test application: every headless
// method with a valid, cancelled and failed answer, the hosted callback's cancelled and
// invalid answers, session restoration, revocation and expiry, and what storage and errors
// must never keep. The recorded API and the fixture page are the ones e2e/auth.spec.mjs uses.

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

async function openApp(page, { url = APP, scenario, create = true, redirectUri } = {}) {
  await page.goto(url);
  await page.waitForSelector("body[data-ready='true']", { state: "attached" });
  await page.evaluate(
    ({ scenario, create, key, redirectUri }) => {
      if (scenario) window.didit.seed(scenario);
      if (create) window.didit.create({ publishableKey: key, redirectUri });
    },
    { scenario, create, key: PUBLISHABLE_KEY, redirectUri }
  );
}

const storedTokens = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), TOKENS);
const events = (page) => page.evaluate(() => window.didit.events);

test("signs in with an emailed code after a wrong one", async ({ page, request }) => {
  const recorded = fixture("email-code");
  await loadRecording(request, "email-code");
  await openApp(page, { scenario: "email-code" });

  const result = await page.evaluate(
    async ({ email, code, wrongCode }) => {
      const start = await window.auth.emailCode.start({ email });
      const wrong = await window.auth.emailCode.verify({ code: wrongCode }).catch((error) => error.code);
      const signedIn = await window.auth.emailCode.verify({ code });
      return { start, wrong, status: signedIn.status, methods: signedIn.status === "signed_in" && signedIn.session.methods };
    },
    { email: "person@example.com", code: recorded.code, wrongCode: recorded.wrongCode }
  );

  expect(result).toEqual({ start: { status: "code_sent", expiresIn: 600 }, wrong: "invalid_grant", status: "signed_in", methods: ["code"] });
  expect((await requestsSeen(request)).filter((entry) => entry.mismatch)).toEqual([]);
});

test("signs up once the address is proven, and reports the password policy first", async ({ page, request }) => {
  const weak = fixture("sign-up-weak-password");
  await loadRecording(request, "sign-up-weak-password");
  await openApp(page, { scenario: "sign-up-weak-password" });
  const refused = await page
    .evaluate(() => window.auth.password.signUp({ email: "weak@example.com", password: "password" }).catch((error) => ({ code: error.code, fields: error.fields })))
  expect(refused).toEqual({ code: "password_policy", fields: { password: ["password_policy"] } });

  const recorded = fixture("sign-up");
  await loadRecording(request, "sign-up");
  await openApp(page, { scenario: "sign-up" });
  const result = await page.evaluate(
    async ({ email, password, code }) => {
      const start = await window.auth.password.signUp({ email, password });
      const signedIn = await window.auth.emailCode.verify({ code });
      return { start, status: signedIn.status, email: signedIn.status === "signed_in" && signedIn.session.email };
    },
    { email: "new-person@example.com", password: PASSWORD, code: recorded.code }
  );
  expect(result).toEqual({
    start: { status: "code_sent", expiresIn: 600 },
    status: "signed_in",
    email: "new-person@example.com"
  });
});

test("completes a sign-in with an authenticator code after a wrong one", async ({ page, request }) => {
  const recorded = fixture("mfa-sign-in");
  await loadRecording(request, "mfa-sign-in");
  await openApp(page, { scenario: "mfa-sign-in" });

  const result = await page.evaluate(
    async ({ email, password, code, wrongCode }) => {
      const first = await window.auth.password.signIn({ email, password });
      const wrong = await window.auth.mfa.verify({ code: wrongCode }).catch((error) => error.code);
      const signedIn = await window.auth.mfa.verify({ code });
      return { first, wrong, status: signedIn.status, mfaVerified: signedIn.status === "signed_in" && signedIn.session.mfaVerified };
    },
    { email: "mfa-person@example.com", password: PASSWORD, code: recorded.code, wrongCode: recorded.wrongCode }
  );

  expect(result).toEqual({ first: { status: "mfa_required" }, wrong: "invalid_grant", status: "signed_in", mfaVerified: true });
  expect((await requestsSeen(request)).filter((entry) => entry.mismatch)).toEqual([]);
});

test("adds an authenticator when the policy requires one, and returns the recovery codes", async ({ page, request }) => {
  const recorded = fixture("mfa-enrollment-required");
  await loadRecording(request, "mfa-enrollment-required");
  await openApp(page, { scenario: "mfa-enrollment-required" });

  const result = await page.evaluate(
    async ({ email, password, code }) => {
      const first = await window.auth.password.signIn({ email, password });
      const setup = await window.auth.mfa.setup({ code });
      return { first, status: setup.status, recoveryCodes: setup.status === "signed_in" && setup.recoveryCodes.length };
    },
    { email: "setup-person@example.com", password: PASSWORD, code: recorded.code }
  );

  expect(result.first.status).toBe("mfa_enrollment_required");
  expect(result.first.uri).toMatch(/^otpauth:\/\/totp\//);
  expect(result).toMatchObject({ status: "signed_in", recoveryCodes: 10 });
});

test("adds an authenticator to the signed-in person", async ({ page, request }) => {
  const recorded = fixture("mfa-enroll");
  await loadRecording(request, "mfa-enroll");
  await openApp(page, { scenario: "mfa-enroll" });

  const result = await page.evaluate(
    async ({ email, password, code }) => {
      await window.auth.password.signIn({ email, password });
      const { uri } = await window.auth.mfa.enroll();
      const { recoveryCodes } = await window.auth.mfa.confirm({ code });
      return { uri, recoveryCodes: recoveryCodes.length };
    },
    { email: "new-person@example.com", password: PASSWORD, code: recorded.code }
  );

  expect(result).toEqual({ uri: expect.stringMatching(/^otpauth:\/\/totp\//), recoveryCodes: 10 });
});

test("reports an invalid phone number and a channel that cannot deliver", async ({ page, request }) => {
  await loadRecording(request, "phone-invalid");
  await openApp(page, { scenario: "phone-invalid" });
  const invalid = await page
    .evaluate(() => window.auth.phone.start({ phone: "123" }).catch((error) => ({ code: error.code, fields: error.fields })));
  expect(invalid).toEqual({ code: "invalid_phone", fields: { phone: ["invalid_phone"] } });

  await loadRecording(request, "phone");
  await openApp(page, { scenario: "phone" });
  const unavailable = await page
    .evaluate(() => window.auth.phone.start({ phone: "+14155550123" }).catch((error) => ({ code: error.code, status: error.status })));
  expect(unavailable).toEqual({ code: "delivery_unavailable", status: 503 });
});

test("lists, approves, denies and revokes an AI agent's access", async ({ page, request }) => {
  const recorded = fixture("agents");
  await loadRecording(request, "agents");
  await openApp(page, { scenario: "agents" });

  const result = await page.evaluate(
    async ({ email, password, challenges }) => {
      await window.auth.password.signIn({ email, password });
      const before = await window.auth.agents.list();
      const needsPasskey = await window.auth
        .agents.consent({ challenge: challenges.passkey, decision: "approve" })
        .catch((error) => error.code);
      const denied = await window.auth.agents.consent({ challenge: challenges.deny, decision: "deny" });
      const approved = await window.auth.agents.consent({ challenge: challenges.approve, decision: "approve" });
      const listed = await window.auth.agents.list();
      await window.auth.agents.revoke(listed[0].id);
      const after = await window.auth.agents.list();
      return { before, needsPasskey, denied, approved, listed, revokedAt: after[0].revokedAt };
    },
    {
      email: "person@example.com",
      password: PASSWORD,
      challenges: {
        passkey: recorded.passkeyChallenge,
        deny: recorded.denyChallenge,
        approve: recorded.approveChallenge
      }
    }
  );

  expect(result.before).toEqual([]);
  expect(result.needsPasskey).toBe("passkey_required");
  expect(result.denied).toEqual({ status: "denied" });
  expect(result.approved.status).toBe("approved");
  expect(result.approved.redirectTo).toBe(recorded.approved.redirectTo);
  expect(result.listed).toEqual(recorded.listed);
  expect(result.revokedAt).toEqual(recorded.after[0].revokedAt);
  expect((await requestsSeen(request)).filter((entry) => entry.mismatch)).toEqual([]);
});

test("reports a cancelled passkey prompt and keeps nothing", async ({ page, request }) => {
  await loadRecording(request, "passkey-begin");
  // The person dismisses the browser's passkey prompt, as the real prompt does on a cancel.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: { get: async () => void (() => { throw new DOMException("The operation was not allowed.", "NotAllowedError"); })() }
    });
    window.PublicKeyCredential = function PublicKeyCredential() {};
  });
  await openApp(page, { scenario: "passkey-begin" });

  const code = await page.evaluate(() => window.auth.passkeys.signIn().catch((error) => error.code));

  expect(code).toBe("passkey_cancelled");
  expect(await storedTokens(page)).toBeNull();
  expect(await page.evaluate(() => window.auth.getToken())).toBeNull();
  // The passkey prompt ran, then stopped: only the start of the ceremony reached Didit.
  expect((await requestsSeen(request)).map(({ method, path }) => `${method} ${path}`)).toEqual([
    "POST authorize/",
    "POST passkeys/begin/"
  ]);
});

test("refuses a passkey on a page that is not the sign-in domain", async ({ page, request }) => {
  await loadRecording(request, "passkey-begin");
  // The API's own host, not the relying party the challenge names: passkeys cannot run here.
  await openApp(page, { url: `${RECORDED_API}/e2e/fixtures/app.html`, scenario: "passkey-begin", redirectUri: APP });

  const code = await page.evaluate(() => window.auth.passkeys.signIn().catch((error) => error.code));

  expect(code).toBe("passkey_unavailable");
  expect(await storedTokens(page)).toBeNull();
});

test("refuses a completed hosted sign-in that this browser did not start, or that was cancelled", async ({ page, request }) => {
  await loadRecording(request, "redirect-sign-in");
  await openApp(page, { scenario: "redirect-sign-in", create: false });
  await page.evaluate((key) => {
    window.auth = window.didit.createDiditAuth({ publishableKey: key, navigate: (url) => void (window.opened = url) });
    window.auth.onAuthStateChange((event, session) => window.didit.events.push([event, session && session.email]));
  }, PUBLISHABLE_KEY);

  // A code and state this browser never kept.
  const rejected = await page.evaluate(async () => {
    history.replaceState(null, "", `${location.pathname}?code=made-up&state=not-ours`);
    const code = await window.auth.handleRedirectCallback().catch((error) => error.code);
    return { code, href: location.href };
  });
  expect(rejected).toEqual({ code: "invalid_state", href: APP });
  expect(await requestsSeen(request)).toEqual([]);

  // The hosted page sent the person back after they dismissed it.
  await page.evaluate(() => window.auth.signIn({ returnTo: "/account" }));
  const cancelled = await page.evaluate(async (key) => {
    const name = Object.keys(localStorage).find((candidate) => candidate.startsWith(`${key}:pending:`));
    const state = name.slice(`${key}:pending:`.length);
    history.replaceState(null, "", `${location.pathname}?error=access_denied&state=${state}`);
    const code = await window.auth.handleRedirectCallback().catch((error) => error.code);
    return { code, pending: Object.keys(localStorage).filter((candidate) => candidate.startsWith(`${key}:pending:`)), href: location.href };
  }, TOKENS);
  expect(cancelled).toEqual({ code: "access_denied", pending: [], href: APP });
  expect(await storedTokens(page)).toBeNull();
  expect(await events(page)).toEqual([]);
});

test("restores the session and its tokens after a reload, without a new sign-in", async ({ page, request }) => {
  const recorded = fixture("password-sign-in");
  await loadRecording(request, "password-sign-in");
  await openApp(page, { scenario: "password-sign-in" });
  const signedIn = await page.evaluate(
    (password) => window.auth.password.signIn({ email: "person@example.com", password }).then((result) => result.session),
    PASSWORD
  );
  const token = await page.evaluate(() => window.auth.getToken());
  expect(signedIn.email).toBe("person@example.com");

  await page.reload();
  await page.waitForSelector("body[data-ready='true']", { state: "attached" });
  await page.evaluate((key) => window.didit.create({ publishableKey: key }), PUBLISHABLE_KEY);

  expect(await page.evaluate(() => window.auth.getToken())).toBe(token);
  expect(await page.evaluate(() => window.auth.getSession())).toMatchObject({
    userId: signedIn.userId,
    sessionId: recorded.exchanges[3].response.body.sid
  });
  expect((await requestsSeen(request)).filter((entry) => entry.mismatch)).toEqual([]);
});

test("a revoked session loses access and signs the browser out", async ({ page, request }) => {
  await loadRecording(request, "revoked-session");
  await openApp(page, { scenario: "revoked-session" });
  await page.evaluate(
    (password) => window.auth.password.signIn({ email: "person@example.com", password }),
    PASSWORD
  );
  expect(await storedTokens(page)).not.toBeNull();

  expect(await page.evaluate(() => window.auth.getSession({ force: true }))).toBeNull();
  expect(await storedTokens(page)).toBeNull();
  expect(await page.evaluate(() => window.auth.getToken())).toBeNull();
  expect(await events(page)).toEqual([["SIGNED_IN", "person@example.com"], ["SIGNED_OUT", null]]);
  expect((await requestsSeen(request)).filter((entry) => entry.mismatch)).toEqual([]);
});

test("an access token the API has already rejected is refreshed once, and the session survives", async ({ page, request }) => {
  const recorded = fixture("expired-access-retry");
  await loadRecording(request, "expired-access-retry");
  await openApp(page, { scenario: "expired-access-retry" });
  await page.evaluate(
    (password) => window.auth.password.signIn({ email: "person@example.com", password }),
    PASSWORD
  );

  expect(await page.evaluate(() => window.auth.getSession({ force: true }))).toMatchObject({ email: "person@example.com" });
  expect((await storedTokens(page)).accessToken).toBe(recorded.exchanges[5].response.body.access_token);
  expect(await events(page)).toEqual([
    ["SIGNED_IN", "person@example.com"],
    ["TOKEN_REFRESHED", "person@example.com"]
  ]);
  expect((await requestsSeen(request)).filter((entry) => entry.mismatch)).toEqual([]);
});

test("neither storage nor a reported error keeps the password, a code or a used sign-in", async ({ page, request }) => {
  await loadRecording(request, "wrong-password");
  await openApp(page, { scenario: "wrong-password" });
  const failure = await page.evaluate(
    (password) => window.auth.password.signIn({ email: "person@example.com", password }).catch((error) => ({ code: error.code, text: `${error.message} ${error.stack}` })),
    "Not-the-password-1"
  );
  expect(failure.code).toBe("invalid_credentials");
  expect(failure.text).not.toContain("Not-the-password-1");
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie])).toEqual([0, 0, ""]);

  const recorded = fixture("password-sign-in");
  await loadRecording(request, "password-sign-in");
  await openApp(page, { scenario: "password-sign-in" });
  await page.evaluate(
    (password) => window.auth.password.signIn({ email: "person@example.com", password }),
    PASSWORD
  );
  const kept = await page.evaluate((key) => {
    const values = Object.keys(localStorage).map((name) => [name, localStorage.getItem(name)]);
    return {
      names: values.map(([name]) => name),
      values: values.map(([, value]) => value).join("\n"),
      session: Object.keys(sessionStorage).map((name) => sessionStorage.getItem(name)).join("\n"),
      cookie: document.cookie,
      href: location.href,
      pending: values.filter(([name]) => name.startsWith(`${key}:pending:`))
    };
  }, TOKENS);

  expect(kept.names).toEqual([TOKENS]);
  for (const secret of [PASSWORD, recorded.exchanges[1].response.body.code]) {
    expect(kept.values).not.toContain(secret);
    expect(kept.session).not.toContain(secret);
    expect(kept.cookie).not.toContain(secret);
    expect(kept.href).not.toContain(secret);
  }
  expect(kept.pending).toEqual([]);
});
