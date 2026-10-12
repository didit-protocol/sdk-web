import { NextRequest } from "next/server";

import { codeChallenge } from "../server/pkce";
import { diditAuthProxy } from "../server/proxy";
import { resetCaches } from "../server/session-cache";
import { ENV, FRONTEND_API, recorded, replay } from "./replay";

const APP = "http://localhost:3000";
const issued = recorded.tokenIssued.body;
const rotated = recorded.tokenRotated.body;
const grantId = recorded.grants.body.results[0].id;
const sessionEnd = Math.floor(Date.parse(recorded.session.body.expires_at) / 1000);

function request(path: string, init: { method?: string; cookies?: Record<string, string>; headers?: Record<string, string> } = {}) {
  const cookie = Object.entries(init.cookies ?? {})
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("; ");

  return new NextRequest(`${APP}${path}`, {
    method: init.method ?? "GET",
    headers: { ...(cookie ? { cookie } : {}), ...init.headers }
  });
}

const signedIn = { didit_at: issued.access_token, didit_rt: `${sessionEnd}.${issued.refresh_token}` };
const expired = { didit_rt: `${sessionEnd}.${issued.refresh_token}` };
const fromApp = { "x-didit-auth": "fetch", origin: APP, "sec-fetch-site": "same-origin" };

let proxy: ReturnType<typeof diditAuthProxy>;

beforeEach(() => {
  resetCaches();
  proxy = diditAuthProxy({ protect: ["/account"] }, ENV);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe("starting a sign-in", () => {
  it("redirects to the hosted page with PKCE and keeps the verifier in an httpOnly cookie", async () => {
    replay();
    const response = await proxy(request("/auth/sign-in?redirect_url=%2Faccount%3Ftab%3Dagents"));
    const hosted = new URL(response.headers.get("location")!);

    expect(response.status).toBe(307);
    expect(`${hosted.origin}${hosted.pathname}`).toBe(`${FRONTEND_API}/sign-in/`);
    expect(hosted.searchParams.get("redirect_uri")).toBe(ENV.DIDIT_REDIRECT_URI);
    expect(hosted.searchParams.get("code_challenge_method")).toBe("S256");
    const state = hosted.searchParams.get("state")!;
    const cookie = response.cookies.get(`didit_tx.${state.slice(0, 16)}`)!;
    const [verifier, savedState, returnTo] = cookie.value.split(":");

    expect(savedState).toBe(state);
    expect(decodeURIComponent(returnTo)).toBe("/account?tab=agents");
    await expect(codeChallenge(verifier)).resolves.toBe(hosted.searchParams.get("code_challenge"));
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 600, secure: false });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("never returns to another site", async () => {
    replay();
    const response = await proxy(request("/auth/sign-up?redirect_url=https%3A%2F%2Fevil.example"));
    const state = new URL(response.headers.get("location")!).searchParams.get("state")!;

    expect(response.cookies.get(`didit_tx.${state.slice(0, 16)}`)!.value.split(":")[2]).toBe(encodeURIComponent("/"));
  });

  it("uses __Host- cookies and Secure over https", async () => {
    replay();
    const secure = diditAuthProxy({}, { DIDIT_FRONTEND_API: "https://auth.example.com", DIDIT_REDIRECT_URI: "https://app.example.com/auth/callback" });
    const response = await secure(new NextRequest("https://app.example.com/auth/step-up"));
    const state = new URL(response.headers.get("location")!).searchParams.get("state")!;

    expect(response.cookies.get(`__Host-didit_tx.${state.slice(0, 16)}`)).toMatchObject({ secure: true, httpOnly: true, path: "/" });
  });
});

describe("the callback", () => {
  async function started() {
    const start = await proxy(request("/auth/sign-in?redirect_url=%2Faccount"));
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const name = `didit_tx.${state.slice(0, 16)}`;

    return { state, name, value: start.cookies.get(name)!.value };
  }

  it("exchanges the code, stores the session in httpOnly cookies and returns to the page", async () => {
    replay();
    const { state, name, value } = await started();
    const { calls, remaining } = replay(
      { method: "POST", path: "token/", response: recorded.tokenIssued },
      { method: "GET", path: "session/", response: recorded.session }
    );
    const response = await proxy(
      request(`/auth/callback?code=the-code&state=${state}`, { cookies: { [name]: value }, headers: { "user-agent": "Browser/1.0" } })
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${APP}/account`);
    expect(calls[0].body).toMatchObject({ grant_type: "authorization_code", code: "the-code", redirect_uri: ENV.DIDIT_REDIRECT_URI });
    expect(calls[0].body!.code_verifier).toBe(value.split(":")[0]);
    expect(calls[0].headers.get("user-agent")).toBe("Browser/1.0");
    expect(response.cookies.get("didit_at")).toMatchObject({ value: issued.access_token, httpOnly: true, maxAge: 294, path: "/" });
    expect(response.cookies.get("didit_rt")).toMatchObject({ value: `${sessionEnd}.${issued.refresh_token}`, httpOnly: true });
    expect(response.cookies.get(name)).toMatchObject({ value: "", maxAge: 0 });
    expect(remaining()).toEqual([]);
  });

  it("ends the earlier session of this browser when someone signs in again", async () => {
    replay();
    const { state, name, value } = await started();
    const { calls } = replay(
      { method: "POST", path: "token/", response: recorded.tokenIssued },
      { method: "GET", path: "session/", response: recorded.session },
      { method: "DELETE", path: "session/", response: recorded.sessionEnded }
    );

    await proxy(request(`/auth/callback?code=c&state=${state}`, { cookies: { [name]: value, didit_at: "previousAccessToken" } }));
    expect(calls[2].headers.get("authorization")).toBe("Bearer previousAccessToken");
  });

  it.each([
    ["a state with no transaction cookie", (state: string) => `/auth/callback?code=c&state=${state}`, false],
    ["a missing code", (state: string) => `/auth/callback?state=${state}`, true]
  ])("refuses %s without calling Didit", async (_, path, withCookie) => {
    replay();
    const { state, name, value } = await started();
    const response = await proxy(request(path(state), { cookies: withCookie ? { [name]: value } : {}, headers: { "accept-language": "es-ES" } }));

    expect(response.status).toBe(400);
    expect(response.cookies.get("didit_at")).toBeUndefined();
    await expect(response.text()).resolves.toContain("No se ha podido completar el inicio de sesión.");
  });

  it("refuses a code Didit rejects", async () => {
    replay();
    const { state, name, value } = await started();

    replay({ method: "POST", path: "token/", response: recorded.tokenInvalidGrant });
    const response = await proxy(request(`/auth/callback?code=spent&state=${state}`, { cookies: { [name]: value } }));

    expect(response.status).toBe(400);
    expect(response.cookies.get("didit_at")).toBeUndefined();
  });
});

describe("pages", () => {
  it("passes a public page through, with the requested path for auth.protect()", async () => {
    replay();
    const response = await proxy(request("/pricing?plan=pro", { headers: { "x-didit-auth-path": "/forged" } }));

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-request-x-didit-auth-path")).toBe("/pricing?plan=pro");
  });

  it("sends a signed-out visitor of a protected path to sign in and back", async () => {
    replay();
    const response = await proxy(request("/account/agents?x=1"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${APP}/auth/sign-in?redirect_url=%2Faccount%2Fagents%3Fx%3D1`);
  });

  it("checks a protected page's session with Didit once, then reuses it", async () => {
    const { calls } = replay({ method: "GET", path: "session/", response: recorded.session });

    expect((await proxy(request("/account", { cookies: signedIn }))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(request("/account/security", { cookies: signedIn }))).headers.get("x-middleware-next")).toBe("1");
    expect(calls).toHaveLength(1);
  });

  it("refreshes an expired access token and hands the new cookies to the page", async () => {
    const { calls } = replay({ method: "POST", path: "token/", response: recorded.tokenRotated });
    const response = await proxy(request("/", { cookies: { ...expired, other: "kept" } }));

    expect(calls[0].body).toEqual({ grant_type: "refresh_token", refresh_token: issued.refresh_token });
    expect(response.cookies.get("didit_at")!.value).toBe(rotated.access_token);
    expect(response.cookies.get("didit_rt")!.value).toBe(`${sessionEnd}.${rotated.refresh_token}`);
    expect(response.headers.get("x-middleware-request-cookie")).toBe(
      `other=kept; didit_at=${rotated.access_token}; didit_rt=${sessionEnd}.${rotated.refresh_token}`
    );
  });

  it("spends a refresh token once when parallel requests need it", async () => {
    const { calls } = replay({ method: "POST", path: "token/", response: recorded.tokenRotated });
    const responses = await Promise.all([
      proxy(request("/", { cookies: expired })),
      proxy(request("/pricing", { cookies: expired })),
      proxy(request("/about", { cookies: expired }))
    ]);

    expect(calls).toHaveLength(1);
    responses.forEach((response) => expect(response.cookies.get("didit_at")!.value).toBe(rotated.access_token));
    // A request that left the browser with the old token a moment later gets the same tokens.
    expect((await proxy(request("/late", { cookies: expired }))).cookies.get("didit_at")!.value).toBe(rotated.access_token);
    expect(calls).toHaveLength(1);
  });

  it("clears the cookies and asks to sign in when the session is over", async () => {
    replay({ method: "POST", path: "token/", response: recorded.tokenInvalidGrant });
    const response = await proxy(request("/account", { cookies: expired }));

    expect(response.status).toBe(307);
    expect(response.cookies.get("didit_at")).toMatchObject({ value: "", maxAge: 0 });
    expect(response.cookies.get("didit_rt")).toMatchObject({ value: "", maxAge: 0 });
  });

  it("refreshes when Didit no longer accepts the access token", async () => {
    replay(
      { method: "GET", path: "session/", response: recorded.sessionInvalid },
      { method: "POST", path: "token/", response: recorded.tokenRotated },
      { method: "GET", path: "session/", response: recorded.session }
    );
    const response = await proxy(request("/account", { cookies: signedIn }));

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.cookies.get("didit_at")!.value).toBe(rotated.access_token);
  });

  it("keeps public pages up when Didit cannot be reached, and fails protected ones", async () => {
    replay({ method: "POST", path: "token/", response: { status: 503, body: { detail: "unavailable" } } });
    expect((await proxy(request("/", { cookies: expired }))).headers.get("x-middleware-next")).toBe("1");

    replay({ method: "POST", path: "token/", response: { status: 503, body: { detail: "unavailable" } } });
    await expect(proxy(request("/account", { cookies: expired }))).rejects.toMatchObject({ status: 503 });
  });
});

describe("the browser routes", () => {
  it("answers the session to this app's own client", async () => {
    replay({ method: "GET", path: "session/", response: recorded.session });
    const response = await proxy(request("/auth/session", { cookies: signedIn, headers: fromApp }));

    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ session: { id: recorded.session.body.sid, user: { email: "person@example.com" } } });
  });

  it("refuses calls without the client header or from another site", async () => {
    replay();
    expect((await proxy(request("/auth/token", { cookies: signedIn }))).status).toBe(403);
    expect(
      (await proxy(request("/auth/token", { cookies: signedIn, headers: { "x-didit-auth": "fetch", "sec-fetch-site": "cross-site" } }))).status
    ).toBe(403);
    expect((await proxy(request("/auth/session", { method: "POST", headers: fromApp }))).status).toBe(405);
  });

  it("hands out the access token only for a valid session", async () => {
    replay({ method: "GET", path: "session/", response: recorded.session });
    await expect((await proxy(request("/auth/token", { cookies: signedIn, headers: fromApp }))).json()).resolves.toEqual({
      token: issued.access_token
    });
    resetCaches();
    replay({ method: "GET", path: "session/", response: recorded.sessionInvalid });
    expect((await proxy(request("/auth/token", { cookies: { didit_at: "revoked" }, headers: fromApp }))).status).toBe(401);
  });

  it("lists agent grants and revokes one for a same-origin caller", async () => {
    const { calls } = replay(
      { method: "GET", path: "session/", response: recorded.session },
      { method: "GET", path: "grants/?limit=100", response: recorded.grants },
      { method: "DELETE", path: `grants/${grantId}/`, response: recorded.grantRevoked }
    );
    const listed = await (await proxy(request("/auth/agents", { cookies: signedIn, headers: fromApp }))).json();

    expect(listed.agents.map((grant: { agentName: string }) => grant.agentName)).toEqual(["Nova", "Ledger Buddy"]);
    expect((await proxy(request(`/auth/agents/${grantId}`, { method: "DELETE", cookies: signedIn, headers: fromApp }))).status).toBe(204);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(["GET session/", "GET grants/?limit=100", `DELETE grants/${grantId}/`]);
  });

  it("refuses to revoke for another origin and reports an unknown grant", async () => {
    replay();
    const foreign = { ...fromApp, origin: "https://evil.example", "sec-fetch-site": "cross-site" };

    expect((await proxy(request(`/auth/agents/${grantId}`, { method: "DELETE", cookies: signedIn, headers: foreign }))).status).toBe(403);
    replay(
      { method: "GET", path: "session/", response: recorded.session },
      { method: "DELETE", path: "grants/00000000-0000-4000-8000-0000000000ff/", response: recorded.grantMissing }
    );
    const missing = await proxy(
      request("/auth/agents/00000000-0000-4000-8000-0000000000ff", { method: "DELETE", cookies: signedIn, headers: fromApp })
    );

    expect(missing.status).toBe(404);
  });
});

describe("signing out", () => {
  it("ends the session at Didit, clears the cookies and goes home", async () => {
    const { calls } = replay({ method: "DELETE", path: "session/", response: recorded.sessionEnded });
    const response = await proxy(request("/auth/sign-out", { method: "POST", cookies: signedIn, headers: { origin: APP } }));

    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${issued.access_token}`);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${APP}/`);
    expect(response.cookies.get("didit_at")).toMatchObject({ value: "", maxAge: 0 });
    expect(response.cookies.get("didit_rt")).toMatchObject({ value: "", maxAge: 0 });
  });

  it("answers 204 to the browser client and refreshes first when only the refresh token is left", async () => {
    const { calls } = replay(
      { method: "POST", path: "token/", response: recorded.tokenRotated },
      { method: "DELETE", path: "session/", response: recorded.sessionEnded }
    );
    const response = await proxy(request("/auth/sign-out", { method: "POST", cookies: expired, headers: fromApp }));

    expect(response.status).toBe(204);
    expect(calls[1].headers.get("authorization")).toBe(`Bearer ${rotated.access_token}`);
  });

  it("refuses a sign-out posted from another site", async () => {
    const { calls } = replay();
    const response = await proxy(
      request("/auth/sign-out", { method: "POST", cookies: signedIn, headers: { origin: "https://evil.example" } })
    );

    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
    expect((await proxy(request("/auth/sign-out", { cookies: signedIn }))).status).toBe(405);
  });
});
