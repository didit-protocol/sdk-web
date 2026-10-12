import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { createDiditAuth } from "../client";
import type { DiditAuthEvent, DiditAuthOptions } from "../types";
import { advanceClock, loadFixture, publishableKeyFor, replay, type Fixture } from "./helpers/replay";

const APPLICATION_ID = "b83c95f9-93bd-4bed-a94f-f4b354a446db";
const PASSWORD = "Correct-horse-battery-91";

function setup(name: string, options: Partial<DiditAuthOptions> = {}) {
  const fixture = loadFixture(name);
  const api = replay(fixture);
  const auth = createDiditAuth({ publishableKey: publishableKeyFor(fixture.apiBase), fetch: api.fetch, ...options });
  return { fixture, api, auth };
}

function stored(): Record<string, unknown> | null {
  return JSON.parse(localStorage.getItem(`didit-auth:${APPLICATION_ID}`) ?? "null");
}

function responseOf(fixture: Fixture, index: number): Record<string, string> {
  return fixture.exchanges[index].response.body as Record<string, string>;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("password sign-in, session, refresh and sign-out", () => {
  it("runs the recorded lifecycle and reports each state change", async () => {
    const { fixture, api, auth } = setup("password-sign-in");
    const events: [DiditAuthEvent, string | null][] = [];
    auth.onAuthStateChange((event, session) => events.push([event, session?.email ?? null]));

    const result = await auth.password.signIn({ email: "person@example.com", password: PASSWORD });

    expect(result.status).toBe("signed_in");
    expect(result.status === "signed_in" && result.session).toEqual({
      userId: "6e911151-6862-4541-851d-23ad36e85ed6",
      sessionId: "214de96d-95e1-47a2-8b0f-ccf3f9b1f170",
      applicationId: APPLICATION_ID,
      vendorData: null,
      email: "person@example.com",
      emailVerified: true,
      phone: null,
      methods: ["password"],
      mfaVerified: false,
      verifiedIdentity: null,
      organizations: [{ id: "3eae0a81-3bff-49c1-8398-8cdc02d88280", name: "Example Team", role: "member" }],
      expiresAt: "2026-11-11T08:14:23.135270Z"
    });
    expect(stored()).toMatchObject({
      accessToken: responseOf(fixture, 2).access_token,
      refreshToken: responseOf(fixture, 2).refresh_token,
      sessionId: "214de96d-95e1-47a2-8b0f-ccf3f9b1f170"
    });
    expect(api.count).toBe(4);

    // Cached: no request within the cache window.
    expect((await auth.getSession())?.userId).toBe("6e911151-6862-4541-851d-23ad36e85ed6");
    expect(api.count).toBe(4);
    await auth.getSession({ force: true });
    expect(api.count).toBe(5);

    // Near expiry, concurrent callers share one refresh: a second one would present a consumed token.
    advanceClock(5 * 60_000);
    const [first, second] = await Promise.all([auth.getToken(), auth.getToken()]);
    expect(first).toBe(responseOf(fixture, 5).access_token);
    expect(second).toBe(first);
    expect(stored()?.refreshToken).toBe(responseOf(fixture, 5).refresh_token);
    expect(api.count).toBe(6);

    expect((await auth.getSession({ force: true }))?.email).toBe("person@example.com");
    await auth.signOut();

    expect(stored()).toBeNull();
    await expect(auth.getSession()).resolves.toBeNull();
    await expect(auth.getToken()).resolves.toBeNull();
    api.verify();
    expect(events).toEqual([
      ["SIGNED_IN", "person@example.com"],
      ["TOKEN_REFRESHED", "person@example.com"],
      ["SIGNED_OUT", null]
    ]);
  });

  it("reports a wrong password and keeps nothing", async () => {
    const { api, auth } = setup("wrong-password");

    await expect(auth.password.signIn({ email: "person@example.com", password: "Not-the-password-1" })).rejects.toMatchObject(
      { name: "DiditAuthError", code: "invalid_credentials", status: 400 }
    );
    expect(stored()).toBeNull();
    api.verify();
  });

  it("reports an unregistered redirect address", async () => {
    const { api, auth } = setup("invalid-redirect", { redirectUri: "http://localhost:4174/not-registered" });

    await expect(auth.password.signIn({ email: "person@example.com", password: PASSWORD })).rejects.toMatchObject({
      code: "invalid_redirect_uri"
    });
    api.verify();
  });

  it("reports rate limiting", async () => {
    const { api, auth } = setup("rate-limited");

    await expect(auth.password.signIn({ email: "person@example.com", password: PASSWORD })).rejects.toMatchObject({
      code: "rate_limited",
      status: 429
    });
    api.verify();
  });

  it("keeps the tokens where the integrator asked", async () => {
    const { api, auth } = setup("password-sign-in", { storage: "session" });

    await auth.password.signIn({ email: "person@example.com", password: PASSWORD });
    expect(stored()).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(`didit-auth:${APPLICATION_ID}`) ?? "null")?.sessionId).toBe(
      "214de96d-95e1-47a2-8b0f-ccf3f9b1f170"
    );
    api.verify(4);
  });

  it("supports an asynchronous custom store", async () => {
    const items = new Map<string, string>();
    const { api, auth } = setup("password-sign-in", {
      storage: {
        getItem: async (key) => items.get(key) ?? null,
        setItem: async (key, value) => void items.set(key, value),
        removeItem: async (key) => void items.delete(key)
      }
    });

    await auth.password.signIn({ email: "person@example.com", password: PASSWORD });
    expect(JSON.parse(items.get(`didit-auth:${APPLICATION_ID}`) ?? "null")?.sessionId).toBe(
      "214de96d-95e1-47a2-8b0f-ccf3f9b1f170"
    );
    expect(await auth.getToken()).toBeTruthy();
    api.verify(4);
  });

  it("isolates listener failures", async () => {
    const { api, auth } = setup("password-sign-in");
    const healthy = jest.fn();
    auth.onAuthStateChange(() => {
      throw new Error("listener bug");
    });
    const unsubscribe = auth.onAuthStateChange(healthy);

    await auth.password.signIn({ email: "person@example.com", password: PASSWORD });
    expect(healthy).toHaveBeenCalledWith("SIGNED_IN", expect.objectContaining({ email: "person@example.com" }));
    unsubscribe();
    api.verify(4);
  });
});

describe("sessions that end elsewhere", () => {
  it("signs out when another client already used the refresh token (reuse revokes the session)", async () => {
    const { api, auth, fixture } = setup("refresh-reuse");
    const events: DiditAuthEvent[] = [];

    await auth.password.signIn({ email: "person@example.com", password: PASSWORD });
    auth.onAuthStateChange((event) => events.push(event));
    advanceClock(5 * 60_000);

    await expect(auth.getToken()).resolves.toBeNull();
    await expect(auth.getSession()).resolves.toBeNull();
    expect(fixture.exchanges[4].response.body).toEqual({ error: "invalid_grant" });
    expect(stored()).toBeNull();
    expect(events).toEqual(["SIGNED_OUT"]);
    api.verify();
  });

  it("refreshes and retries once when the API rejects an access token this client thought valid", async () => {
    const { api, auth, fixture } = setup("expired-access-retry");

    await auth.password.signIn({ email: "person@example.com", password: PASSWORD });
    const session = await auth.getSession({ force: true });

    expect(session?.email).toBe("person@example.com");
    expect(stored()?.accessToken).toBe(responseOf(fixture, 5).access_token);
    api.verify();
  });

  it("signs out when the session was revoked", async () => {
    const { api, auth } = setup("revoked-session");
    const events: DiditAuthEvent[] = [];

    await auth.password.signIn({ email: "person@example.com", password: PASSWORD });
    auth.onAuthStateChange((event) => events.push(event));

    await expect(auth.getSession({ force: true })).resolves.toBeNull();
    expect(stored()).toBeNull();
    expect(events).toEqual(["SIGNED_OUT"]);
    api.verify();
  });
});

describe("other tabs", () => {
  const KEY = `didit-auth:${APPLICATION_ID}`;

  // As a browser does: the shared storage holds the new value before the other tabs get the event.
  function otherTabWrites(newValue: string | null): void {
    const oldValue = localStorage.getItem(KEY);
    if (newValue === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, newValue);
    window.dispatchEvent(new StorageEvent("storage", { key: KEY, oldValue, newValue, storageArea: localStorage }));
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("follows sign-outs and refreshes made by another tab", async () => {
    const { api, auth } = setup("password-sign-in");
    await auth.password.signIn({ email: "person@example.com", password: PASSWORD });
    const listener = jest.fn();
    const unsubscribe = auth.onAuthStateChange(listener);
    const before = localStorage.getItem(KEY);
    const rotated = JSON.stringify({ ...JSON.parse(before ?? "{}"), accessToken: "rotated", refreshToken: "rotated" });

    otherTabWrites(rotated);
    await settle();
    otherTabWrites(null);
    await settle();

    expect(listener.mock.calls.map(([event]) => event)).toEqual(["TOKEN_REFRESHED", "SIGNED_OUT"]);
    unsubscribe();
    otherTabWrites(before);
    await settle();
    expect(listener).toHaveBeenCalledTimes(2);
    api.verify(4);
  });

  it("reports nothing for another tab's change that arrives after this tab signed out", async () => {
    const { api, auth, fixture } = setup("password-sign-in");
    await auth.password.signIn({ email: "person@example.com", password: PASSWORD });
    advanceClock(5 * 60_000);
    await auth.getToken();
    const listener = jest.fn();
    auth.onAuthStateChange(listener);
    const before = localStorage.getItem(KEY);
    const rotated = JSON.stringify({ ...JSON.parse(before ?? "{}"), accessToken: "rotated", refreshToken: "rotated" });

    // The other tab refreshed first, but its event reaches this tab only after this tab's sign-out.
    localStorage.setItem(KEY, rotated);
    await auth.getSession({ force: true });
    await auth.signOut();
    window.dispatchEvent(new StorageEvent("storage", { key: KEY, oldValue: before, newValue: rotated, storageArea: localStorage }));
    await settle();

    expect(listener.mock.calls.map(([event]) => event)).toEqual(["SIGNED_OUT"]);
    expect(stored()).toBeNull();
    expect(fixture.exchanges[7].request.method).toBe("DELETE");
    api.verify(7);
  });
});
