import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { createDiditAuth } from "../client";
import { codeChallenge } from "../encoding";
import type { DiditAuthEvent } from "../types";
import { advanceClock, atOrigin, KEYS, loadFixture, replay, runtimeOf, type Fixture } from "./helpers/replay";

const APPLICATION_ID = "b83c95f9-93bd-4bed-a94f-f4b354a446db";
const PASSWORD = "Correct-horse-battery-91";
const TOKENS = `didit-auth:${KEYS.localSandbox.origin}`;
const PENDING = `${TOKENS}:pending:`;

interface PendingSignIn {
  verifier: string;
  redirectUri: string;
  returnTo: string | null;
  stepUpUser: string | null;
}

/** A hosted sign-in the recording started in one tab, and the person who completed it. */
interface RecordedSignIn {
  email: string;
  signInUrl: string;
  callbackUrl: string;
  sessionId: string;
}

/** A client in another tab of the same browser: same application, same localStorage, same recorded API. */
function tab(fixture: Fixture, api: ReturnType<typeof replay>, publishableKey = runtimeOf(fixture).publishableKey) {
  const navigate = jest.fn<(url: string) => void>();
  return { auth: createDiditAuth({ publishableKey, fetch: api.fetch, navigate }), navigate };
}

function setup(name: string) {
  const fixture = loadFixture(name);
  const api = replay(fixture);
  return { fixture, api, ...tab(fixture, api) };
}

function tokens(): Record<string, string> | null {
  return JSON.parse(localStorage.getItem(TOKENS) ?? "null");
}

/** The hosted sign-ins waiting in localStorage, by state. */
function pendingSignIns(): Record<string, PendingSignIn> {
  const entries: Record<string, PendingSignIn> = {};
  for (let index = 0; index < localStorage.length; index++) {
    const name = localStorage.key(index) as string;
    if (name.startsWith(PENDING)) entries[name.slice(PENDING.length)] = JSON.parse(localStorage.getItem(name) as string);
  }
  return entries;
}

const openedState = (navigate: jest.Mock<(url: string) => void>) =>
  new URL(navigate.mock.calls[0][0]).searchParams.get("state") as string;

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, "", "/e2e/fixtures/app.html");
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("hosted sign-in", () => {
  it("opens the hosted page with PKCE and completes on the redirect page", async () => {
    const { fixture, api, auth, navigate } = setup("redirect-sign-in");
    const events: DiditAuthEvent[] = [];
    auth.onAuthStateChange((event) => events.push(event));

    await auth.signIn({ returnTo: "/account" });

    const opened = new URL(navigate.mock.calls[0][0]);
    expect(opened.href).toBe(atOrigin(fixture, fixture.signInUrl as string));
    expect(opened.origin + opened.pathname).toBe(`${runtimeOf(fixture).origin}/sign-in/`);
    expect(Object.fromEntries(opened.searchParams)).toMatchObject({
      redirect_uri: "http://localhost:4174/e2e/fixtures/app.html",
      code_challenge_method: "S256",
      language: "en"
    });
    // The verifier waits in localStorage, so a link opened in another tab can complete the sign-in.
    expect(Object.keys(pendingSignIns())).toEqual([opened.searchParams.get("state")]);
    expect(api.count).toBe(0);

    const callback = new URL(fixture.callbackUrl as string);
    history.pushState(null, "", callback.pathname + callback.search);
    const { session, returnTo } = await auth.handleRedirectCallback();

    expect(session.email).toBe("person@example.com");
    expect(returnTo).toBe("/account");
    expect(location.href).toBe("http://localhost:4174/e2e/fixtures/app.html");
    expect(pendingSignIns()).toEqual({});
    expect(tokens()?.sessionId).toBe(session.sessionId);
    expect(events).toEqual(["SIGNED_IN"]);
    api.verify();
  });

  it("refuses a redirect it did not start, or one it already used", async () => {
    const { fixture, api, auth } = setup("redirect-sign-in");

    await expect(auth.handleRedirectCallback(fixture.callbackUrl as string)).rejects.toMatchObject({
      code: "invalid_state"
    });
    await auth.signIn();
    await auth.handleRedirectCallback(fixture.callbackUrl as string);
    await expect(auth.handleRedirectCallback(fixture.callbackUrl as string)).rejects.toMatchObject({
      code: "invalid_state"
    });
    api.verify();
  });

  it("forgets abandoned sign-ins after twenty minutes", async () => {
    const { fixture, api, auth } = setup("redirect-sign-in");

    await auth.signIn();
    const now = Date.now();
    jest.spyOn(Date, "now").mockImplementation(() => now + 21 * 60_000);

    await expect(auth.handleRedirectCallback(fixture.callbackUrl as string)).rejects.toMatchObject({
      code: "invalid_state"
    });
    api.verify(0);
  });

  it("opens the hosted page with every method for magic links and social providers", async () => {
    const { fixture, auth, navigate } = setup("redirect-sign-in");

    await auth.magicLink.signIn();
    await auth.social.signIn({ language: "es" });
    // @ts-expect-error The hosted page cannot open on one chosen provider yet.
    await auth.social.signIn({ provider: "google" });

    const [magic, social] = navigate.mock.calls.map(([url]) => new URL(url));
    for (const opened of [magic, social]) {
      expect(opened.origin + opened.pathname).toBe(`${runtimeOf(fixture).origin}/sign-in/`);
      // The hosted page refuses parameters it does not know, so nothing beyond the authorization is sent.
      expect([...opened.searchParams.keys()].sort()).toEqual([
        "code_challenge",
        "code_challenge_method",
        "language",
        "redirect_uri",
        "state"
      ]);
    }
    expect(social.searchParams.get("language")).toBe("es");
  });
});

describe("hosted sign-ins in several tabs", () => {
  it.each(["redirect-two-tabs", "redirect-two-tabs-reversed"])(
    "completes both sign-ins two tabs start at the same moment, each with its own verifier and person (%s)",
    async (name) => {
      const fixture = loadFixture(name);
      const api = replay(fixture);
      const tabs = [tab(fixture, api), tab(fixture, api)];
      const signIns = fixture.signIns as RecordedSignIn[];
      const order = fixture.completionOrder as number[];

      await Promise.all(tabs.map(({ auth }) => auth.signIn()));
      expect(tabs.map(({ navigate }) => navigate.mock.calls[0][0])).toEqual(signIns.map(({ signInUrl }) => atOrigin(fixture, signInUrl)));

      for (const index of order) {
        const { session } = await tabs[index].auth.handleRedirectCallback(signIns[index].callbackUrl);
        expect(session).toMatchObject({ email: signIns[index].email, sessionId: signIns[index].sessionId });
      }
      // Tabs share the session: the one completed last stays, and the one it replaced ended at Didit.
      expect(tokens()?.sessionId).toBe(signIns[order[1]].sessionId);
      expect(fixture.exchanges[fixture.exchanges.length - 1].request).toEqual({
        method: "DELETE",
        path: "session/",
        authorization: `Bearer ${(fixture.exchanges[0].response.body as { access_token: string }).access_token}`
      });
      expect(fixture.replacedSessionRevoked).toBe(true);
      expect(pendingSignIns()).toEqual({});
      api.verify();
    }
  );

  it("never brings back a sign-in completed while another tab starts one", async () => {
    const { fixture, api, auth } = setup("redirect-sign-in");
    const other = tab(fixture, api);

    await auth.signIn();
    await Promise.all([auth.handleRedirectCallback(fixture.callbackUrl as string), other.auth.signIn()]);

    await expect(auth.handleRedirectCallback(fixture.callbackUrl as string)).rejects.toMatchObject({
      code: "invalid_state"
    });
    expect(Object.keys(pendingSignIns())).toEqual([openedState(other.navigate)]);
    api.verify();
  });

  it("exchanges the code once when the redirect page handles it twice at the same time", async () => {
    const { fixture, api, auth } = setup("redirect-sign-in");

    await auth.signIn();
    const [first, second] = await Promise.allSettled([
      auth.handleRedirectCallback(fixture.callbackUrl as string),
      auth.handleRedirectCallback(fixture.callbackUrl as string)
    ]);

    expect(first).toMatchObject({ status: "fulfilled", value: { session: { email: "person@example.com" } } });
    expect(second).toMatchObject({ status: "rejected", reason: { code: "invalid_state" } });
    api.verify();
  });

  it("signs in once when a link opens in two tabs at once: the API exchanges each code once", async () => {
    const fixture = loadFixture("redirect-code-reused");
    const api = replay(fixture);
    const [first, second] = [tab(fixture, api), tab(fixture, api)];

    await first.auth.signIn();
    // The second tab read the sign-in before the first tab's removal reached it.
    const raw = Object.entries(localStorage).filter(([name]) => name.startsWith(PENDING));
    const { session } = await first.auth.handleRedirectCallback(fixture.callbackUrl as string);
    raw.forEach(([name, value]) => localStorage.setItem(name, value));

    await expect(second.auth.handleRedirectCallback(fixture.callbackUrl as string)).rejects.toMatchObject({
      code: "invalid_grant"
    });
    // The refused code changed nothing: the first tab's session stays, here and at Didit.
    expect(tokens()?.sessionId).toBe(session.sessionId);
    expect(fixture.firstSessionActive).toBe(true);
    api.verify();
  });

  it("stores each sign-in under its own state, with its own verifier and reauthentication binding", async () => {
    const { fixture, api, auth, navigate } = setup("step-up");
    const other = tab(fixture, api);

    await auth.password.signIn({ email: "person@example.com", password: PASSWORD });
    await auth.reauthenticate();
    await other.auth.signIn();

    const stored = pendingSignIns();
    const [again, signIn] = [openedState(navigate), openedState(other.navigate)];
    expect(Object.keys(stored).sort()).toEqual([again, signIn].sort());
    expect(stored[again].stepUpUser).toBe(fixture.result);
    expect(stored[signIn].stepUpUser).toBeNull();
    for (const [state, opened] of [
      [again, navigate],
      [signIn, other.navigate]
    ] as const) {
      // Each verifier answers the challenge its own hosted page was opened with.
      const challenge = new URL(opened.mock.calls[0][0]).searchParams.get("code_challenge");
      expect(await codeChallenge(stored[state].verifier)).toBe(challenge);
    }

    const { session } = await auth.handleRedirectCallback(fixture.callbackUrl as string);
    expect(session.userId).toBe(fixture.result);
    expect(Object.keys(pendingSignIns())).toEqual([signIn]);
    api.verify();
  });

  it("keeps the sign-ins of two applications on one origin apart", async () => {
    const { fixture, api, auth } = setup("redirect-sign-in");
    const otherApplication = tab(fixture, api, KEYS.live.publishableKey);

    await auth.signIn();
    await expect(otherApplication.auth.handleRedirectCallback(fixture.callbackUrl as string)).rejects.toMatchObject({
      code: "invalid_state"
    });
    const { session } = await auth.handleRedirectCallback(fixture.callbackUrl as string);

    expect(session.applicationId).toBe(APPLICATION_ID);
    api.verify();
  });

  it("forgets sign-ins abandoned in any tab once they expire, and keeps the ones still waiting", async () => {
    const { fixture, api, auth, navigate } = setup("redirect-sign-in");
    const other = tab(fixture, api);

    await auth.signIn();
    advanceClock(15 * 60_000);
    await other.auth.signIn();
    advanceClock(10 * 60_000);
    await auth.signIn();

    expect(Object.keys(pendingSignIns()).sort()).toEqual(
      [openedState(other.navigate), new URL(navigate.mock.calls[1][0]).searchParams.get("state")].sort()
    );
  });

  it("refuses a redirect without its state", async () => {
    const { fixture, api, auth } = setup("redirect-sign-in");
    const withoutState = new URL(fixture.callbackUrl as string);
    withoutState.searchParams.delete("state");

    await auth.signIn();
    await expect(auth.handleRedirectCallback(withoutState.href)).rejects.toMatchObject({ code: "invalid_state" });
    expect(Object.keys(pendingSignIns())).toHaveLength(1);
    api.verify(0);
  });
});

describe("browser storage", () => {
  it("does not open the hosted page when the browser refuses to keep the sign-in", async () => {
    const { auth, api, navigate } = setup("redirect-sign-in");

    await auth.signIn();
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });

    await expect(auth.signIn()).rejects.toMatchObject({ name: "QuotaExceededError" });
    expect(navigate).toHaveBeenCalledTimes(1);
    api.verify(0);
  });

  it("refuses the redirect, without sending its code, when the browser blocks reading the sign-in", async () => {
    const { fixture, api, auth } = setup("redirect-sign-in");

    await auth.signIn();
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Access is denied.", "SecurityError");
    });

    await expect(auth.handleRedirectCallback(fixture.callbackUrl as string)).rejects.toMatchObject({
      code: "invalid_state"
    });
    api.verify(0);
  });

  it("completes with an asynchronous custom token store, keeping the verifier in browser storage", async () => {
    const fixture = loadFixture("redirect-sign-in");
    const api = replay(fixture);
    const items = new Map<string, string>();
    const auth = createDiditAuth({
      publishableKey: runtimeOf(fixture).publishableKey,
      fetch: api.fetch,
      navigate: () => undefined,
      storage: {
        getItem: async (name) => items.get(name) ?? null,
        setItem: async (name, value) => void items.set(name, value),
        removeItem: async (name) => void items.delete(name)
      }
    });

    await auth.signIn();
    // A magic link opened in another tab has to find the verifier, so it waits in localStorage.
    expect(items.size).toBe(0);
    expect(Object.keys(pendingSignIns())).toHaveLength(1);
    const { session } = await auth.handleRedirectCallback(fixture.callbackUrl as string);

    expect(JSON.parse(items.get(TOKENS) as string).sessionId).toBe(session.sessionId);
    expect(tokens()).toBeNull();
    api.verify();
  });
});

describe("reauthenticate", () => {
  it("replaces the session with a fresh one for the same person and ends the old one", async () => {
    const { fixture, api, auth, navigate } = setup("step-up");

    await auth.password.signIn({ email: "person@example.com", password: PASSWORD });
    const before = tokens();
    await expect(auth.reauthenticate()).resolves.toBeNull();
    expect(navigate.mock.calls[0][0]).toBe(atOrigin(fixture, fixture.signInUrl as string));

    const { session } = await auth.handleRedirectCallback(fixture.callbackUrl as string);

    expect(session.userId).toBe(fixture.result);
    expect(tokens()?.sessionId).not.toBe(before?.sessionId);
    // The last recorded request ends the replaced session with its own token.
    expect(fixture.exchanges[fixture.exchanges.length - 1].request).toEqual({
      method: "DELETE",
      path: "session/",
      authorization: `Bearer ${before?.accessToken}`
    });
    api.verify();
  });

  it("ends the replaced session even when its access token expired while the person was on the hosted page", async () => {
    const { fixture, api, auth } = setup("step-up-expired");

    await auth.password.signIn({ email: "person@example.com", password: PASSWORD });
    const before = tokens();
    await auth.reauthenticate();
    advanceClock(5 * 60_000);

    const { session } = await auth.handleRedirectCallback(fixture.callbackUrl as string);

    expect(session.userId).toBe(fixture.result);
    expect(tokens()?.sessionId).toBe(fixture.sessionAfter);
    // The API only ends a session for a live access token: the replaced one is renewed, then ended with the renewal.
    const [renewal, end] = fixture.exchanges.slice(-2);
    expect(renewal.request.body).toEqual({ grant_type: "refresh_token", refresh_token: before?.refreshToken });
    expect(end.request).toEqual({
      method: "DELETE",
      path: "session/",
      authorization: `Bearer ${(renewal.response.body as { access_token: string }).access_token}`
    });
    expect(end.response.status).toBe(204);
    expect(fixture.sessionBefore).toBe(before?.sessionId);
    expect(fixture.replacedSessionRevoked).toBe(true);
    api.verify();
  });

  it("refuses a reauthentication completed by someone else, ends that session and keeps the original", async () => {
    const { fixture, api, auth } = setup("step-up-mismatch");

    await auth.password.signIn({ email: "person@example.com", password: PASSWORD });
    await auth.reauthenticate();

    await expect(auth.handleRedirectCallback(fixture.callbackUrl as string)).rejects.toMatchObject({
      code: "step_up_user_mismatch"
    });
    expect(tokens()?.sessionId).toBe(fixture.sessionBefore);
    const last = fixture.exchanges[fixture.exchanges.length - 1].request;
    expect(last.method).toBe("DELETE");
    expect(last.authorization).not.toContain(tokens()?.accessToken);
    api.verify();
  });

  it("needs a signed-in person", async () => {
    const { auth } = setup("step-up");

    await expect(auth.reauthenticate()).rejects.toMatchObject({ code: "not_signed_in" });
  });
});
