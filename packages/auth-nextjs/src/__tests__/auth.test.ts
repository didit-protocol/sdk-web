jest.mock("next/headers", () => ({ cookies: jest.fn(), headers: jest.fn() }));

import { cookies, headers } from "next/headers";

import { auth } from "../server/auth";
import { resetCaches } from "../server/session-cache";
import { coreFixture, ENV, recorded, replay } from "./replay";

// next/headers only works inside a Next.js request; these stand in for the request's cookies and headers.
function requestWith(cookieValues: Record<string, string>, headerValues: Record<string, string> = {}) {
  (cookies as jest.Mock).mockResolvedValue({ get: (name: string) => (name in cookieValues ? { name, value: cookieValues[name] } : undefined) });
  (headers as jest.Mock).mockResolvedValue(new Headers(headerValues));
}

beforeAll(() => Object.assign(process.env, ENV));
beforeEach(() => resetCaches());

describe("auth()", () => {
  it("is signed out without asking Didit when there is no session cookie", async () => {
    const { calls } = replay();

    requestWith({});
    await expect(auth()).resolves.toMatchObject({ session: null, userId: null, sessionId: null });
    expect(calls).toHaveLength(0);
  });

  it("returns the session Didit confirms, and the access token for your own API", async () => {
    const { calls } = replay({ method: "GET", path: "session/", response: recorded.session });

    requestWith({ didit_at: recorded.tokenIssued.body.access_token });
    const state = await auth();

    expect(state.userId).toBe(recorded.session.body.sub);
    expect(state.sessionId).toBe(recorded.session.body.sid);
    expect(state.session?.user.email).toBe("person@example.com");
    await expect(state.getToken()).resolves.toBe(recorded.tokenIssued.body.access_token);
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${recorded.tokenIssued.body.access_token}`);
  });

  it("reads a step-up from Didit with the person's token, for a server action to check before acting", async () => {
    const check = coreFixture("step-up-check");
    const passed = check.exchanges.filter(({ request }: { request: { path: string } }) => request.path === `step-up/${check.contact.id}/`)[1];
    const { calls } = replay(
      { method: "GET", path: "session/", response: recorded.session },
      { method: "GET", path: passed.request.path, response: passed.response }
    );
    const { href: _returnedTo, ...approved } = check.outcome;

    requestWith({ didit_at: recorded.tokenIssued.body.access_token });
    await expect((await auth()).getStepUp(check.contact.id)).resolves.toEqual(approved);
    expect(calls[1].headers.get("authorization")).toBe(`Bearer ${recorded.tokenIssued.body.access_token}`);
  });

  it("does not trust a token Didit refuses", async () => {
    replay({ method: "GET", path: "session/", response: recorded.sessionInvalid });
    requestWith({ didit_at: "revoked" });
    const state = await auth();

    expect(state.session).toBeNull();
    await expect(state.getToken()).resolves.toBeNull();
    await expect(state.getStepUp("00000000-0000-4000-8000-000000000009")).resolves.toBeNull();
  });

  it("protect() sends a signed-out visitor to sign in, back to the page they asked for", async () => {
    replay();
    requestWith({}, { "x-didit-auth-path": "/account/agents?x=1" });
    const error = (await auth.protect().catch((caught: unknown) => caught)) as { digest: string };

    expect(error.digest).toContain("/auth/sign-in?redirect_url=%2Faccount%2Fagents%3Fx%3D1");
  });

  it("protect() ignores a forged path that leaves the site", async () => {
    replay();
    requestWith({}, { "x-didit-auth-path": "//evil.example" });
    const error = (await auth.protect({ signInUrl: "/sign-in" }).catch((caught: unknown) => caught)) as { digest: string };

    expect(error.digest).toMatch(/;\/sign-in;/);
  });
});
