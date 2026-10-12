import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { createDiditAuth } from "../client";
import type { DiditAuthEvent } from "../types";
import { loadFixture, publishableKeyFor, replay } from "./helpers/replay";

const APPLICATION_ID = "b83c95f9-93bd-4bed-a94f-f4b354a446db";
const PASSWORD = "Correct-horse-battery-91";

function setup(name: string) {
  const fixture = loadFixture(name);
  const api = replay(fixture);
  const navigate = jest.fn<(url: string) => void>();
  const auth = createDiditAuth({ publishableKey: publishableKeyFor(fixture.apiBase), fetch: api.fetch, navigate });
  return { fixture, api, auth, navigate };
}

function tokens(): Record<string, string> | null {
  return JSON.parse(localStorage.getItem(`didit-auth:${APPLICATION_ID}`) ?? "null");
}

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
    expect(opened.href).toBe(fixture.signInUrl);
    expect(opened.origin + opened.pathname).toBe(`${fixture.apiBase}/sign-in/`);
    expect(Object.fromEntries(opened.searchParams)).toMatchObject({
      redirect_uri: "http://localhost:4174/e2e/fixtures/app.html",
      code_challenge_method: "S256",
      language: "en"
    });
    // The verifier waits in localStorage, so a link opened in another tab can complete the sign-in.
    expect(Object.keys(JSON.parse(localStorage.getItem(`didit-auth:${APPLICATION_ID}:pending`) ?? "{}"))).toEqual([
      opened.searchParams.get("state")
    ]);
    expect(api.count).toBe(0);

    const callback = new URL(fixture.callbackUrl as string);
    history.pushState(null, "", callback.pathname + callback.search);
    const { session, returnTo } = await auth.handleRedirectCallback();

    expect(session.email).toBe("person@example.com");
    expect(returnTo).toBe("/account");
    expect(location.href).toBe("http://localhost:4174/e2e/fixtures/app.html");
    expect(localStorage.getItem(`didit-auth:${APPLICATION_ID}:pending`)).toBeNull();
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
      expect(opened.origin + opened.pathname).toBe(`${fixture.apiBase}/sign-in/`);
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

describe("step-up", () => {
  it("replaces the session with a fresh one for the same person and ends the old one", async () => {
    const { fixture, api, auth, navigate } = setup("step-up");

    await auth.password.signIn({ email: "person@example.com", password: PASSWORD });
    const before = tokens();
    await expect(auth.stepUp()).resolves.toBeNull();
    expect(navigate.mock.calls[0][0]).toBe(fixture.signInUrl);

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

  it("refuses a step-up completed by someone else, ends that session and keeps the original", async () => {
    const { fixture, api, auth } = setup("step-up-mismatch");

    await auth.password.signIn({ email: "person@example.com", password: PASSWORD });
    await auth.stepUp();

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

    await expect(auth.stepUp()).rejects.toMatchObject({ code: "not_signed_in" });
  });
});
