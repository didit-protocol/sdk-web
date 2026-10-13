/**
 * @jest-environment jsdom
 */
// The headless steps run on the browser core, which @didit-protocol/auth tests against recorded API exchanges.
const core = {
  password: { signIn: jest.fn() },
  emailCode: { start: jest.fn(), verify: jest.fn() },
  phone: { start: jest.fn(), verify: jest.fn() },
  protection: { verify: jest.fn(), passkey: jest.fn() },
  mfa: { verify: jest.fn(), setup: jest.fn() }
};
const createDiditAuth = jest.fn((_options: { exchangeCode(grant: object): Promise<unknown> }) => core);

jest.mock("@didit-protocol/auth", () => ({ createDiditAuth }), { virtual: true });

import { createRouteClient } from "../client/route-client";
import { toGrant, toSession } from "../server/runtime-api";
import { coreFixture, ENV, recorded } from "./replay";

const session = toSession(recorded.session.body);
const grants = recorded.grants.body.results.map(toGrant);
const stepUpCheck = coreFixture("step-up-check");
const protection = coreFixture("protection-email-code");

function routes(answers: Record<string, { status: number; body?: unknown }>) {
  const calls: { method: string; path: string; headers: Headers; body: unknown }[] = [];

  global.fetch = jest.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const path = String(input);

    calls.push({ method, path, headers: new Headers(init.headers), body: init.body ? JSON.parse(String(init.body)) : null });
    const answer = answers[`${method} ${path}`];

    if (!answer) throw new Error(`Unexpected ${method} ${path}`);
    return { ok: answer.status < 400, status: answer.status, json: async () => answer.body } as Response;
  }) as typeof fetch;
  return calls;
}

describe("the Next.js browser client", () => {
  it("starts from the session the server rendered and does not ask again", async () => {
    const calls = routes({});
    const client = createRouteClient({ initialSession: session });

    expect(client.getSnapshot()).toEqual({ status: "signed-in", session });
    await client.load();
    expect(calls).toHaveLength(0);
  });

  it("asks the proxy for the session when the server did not render one", async () => {
    const calls = routes({ "GET /auth/session": { status: 200, body: { session } } });
    const client = createRouteClient();
    const seen: string[] = [];

    client.subscribe(() => seen.push(client.getSnapshot().status));
    expect(client.getSnapshot().status).toBe("loading");
    await client.load();
    expect(client.getSnapshot().session?.id).toBe(session.id);
    expect(seen).toEqual(["signed-in"]);
    expect(calls[0].headers.get("x-didit-auth")).toBe("fetch");
  });

  it("reads as signed out when the proxy cannot be reached", async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError("offline");
    }) as typeof fetch;
    const client = createRouteClient();

    await client.load();
    expect(client.getSnapshot()).toEqual({ status: "signed-out", session: null });
  });

  it("takes a newer server session but ignores the same one again", () => {
    const client = createRouteClient({ initialSession: session });
    const listener = jest.fn();

    client.subscribe(listener);
    client.setSession({ ...session });
    expect(listener).not.toHaveBeenCalled();
    client.setSession(null);
    expect(client.getSnapshot().status).toBe("signed-out");
  });

  it("opens the hosted page through the proxy routes", async () => {
    const navigate = jest.fn();
    const client = createRouteClient({ initialSession: null, navigate });

    window.history.replaceState(null, "", "/pricing?plan=pro");
    await client.signIn();
    await client.signUp({ redirectUrl: "/welcome" });
    await client.reauthenticate();
    expect(navigate.mock.calls.map(([url]) => url)).toEqual([
      "/auth/sign-in?redirect_url=%2Fpricing%3Fplan%3Dpro",
      "/auth/sign-up?redirect_url=%2Fwelcome",
      "/auth/reauthenticate?redirect_url=%2Fpricing%3Fplan%3Dpro"
    ]);
  });

  it("signs out through the proxy, then leaves the page", async () => {
    const calls = routes({ "POST /auth/sign-out": { status: 204 } });
    const navigate = jest.fn();
    const client = createRouteClient({ initialSession: session, navigate });

    await client.signOut({ redirectUrl: "/goodbye" });
    expect(calls[0].method).toBe("POST");
    expect(client.getSnapshot().status).toBe("signed-out");
    expect(navigate).toHaveBeenCalledWith("/goodbye");
  });

  it("gets a token, lists and revokes agents", async () => {
    const calls = routes({
      "GET /auth/token": { status: 200, body: { token: "accessToken1" } },
      "GET /auth/agents": { status: 200, body: { agents: grants } },
      [`DELETE /auth/agents/${grants[0].id}`]: { status: 204 }
    });
    const client = createRouteClient({ initialSession: session });

    await expect(client.getToken()).resolves.toBe("accessToken1");
    await expect(client.listAgents()).resolves.toEqual(grants);
    await client.revokeAgent(grants[0].id);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /auth/token",
      "GET /auth/agents",
      `DELETE /auth/agents/${grants[0].id}`
    ]);
  });

  it("reports failures instead of pretending", async () => {
    routes({ "GET /auth/token": { status: 401 }, "GET /auth/agents": { status: 500 }, "DELETE /auth/agents/x": { status: 404 } });
    const client = createRouteClient({ initialSession: session });

    await expect(client.getToken()).resolves.toBeNull();
    await expect(client.listAgents()).rejects.toThrow(/500/);
    await expect(client.revokeAgent("x")).rejects.toThrow(/404/);
  });
});

it("keeps the signed-in state and allows retry when sign-out is rejected", async () => {
  routes({ "POST /auth/sign-out": { status: 503 } });
  const navigate = jest.fn();
  const client = createRouteClient({ initialSession: session, navigate });

  await expect(client.signOut()).rejects.toThrow(/retry/);
  expect(client.getSnapshot().status).toBe("signed-in");
  expect(navigate).not.toHaveBeenCalled();
});

it("updates claims even when the server session id and expiry are unchanged", () => {
  const client = createRouteClient({ initialSession: session });

  client.setSession({ ...session, user: { ...session.user, emailVerified: false } });
  expect(client.getSnapshot().session?.user.emailVerified).toBe(false);
});

describe("step-up", () => {
  const { id } = stepUpCheck.contact;

  it("asks the proxy, opens the identity check, and comes back to this page", async () => {
    const calls = routes({
      "POST /auth/step-up": { status: 200, body: { stepUp: stepUpCheck.contact, verificationUrl: stepUpCheck.verificationUrl } }
    });
    const navigate = jest.fn();
    const client = createRouteClient({ initialSession: session, navigate });

    window.history.replaceState(null, "", "/account/security?tab=email");
    await expect(client.stepUp({ action: "contact" })).resolves.toEqual(stepUpCheck.contact);
    expect(calls[0].body).toEqual({ action: "contact", redirect_url: "/account/security?tab=email" });
    expect(calls[0].headers.get("x-didit-auth")).toBe("fetch");
    expect(navigate).toHaveBeenCalledWith(stepUpCheck.verificationUrl);
  });

  it("stays on the page when no rule asks for a check, and reports a refusal", async () => {
    routes({ "POST /auth/step-up": { status: 200, body: { stepUp: stepUpCheck.payout } } });
    const navigate = jest.fn();
    const client = createRouteClient({ initialSession: session, navigate });

    await expect(client.stepUp({ action: "payout", amount: "900.00", currency: "USD" })).resolves.toEqual(stepUpCheck.payout);
    expect(navigate).not.toHaveBeenCalled();
    routes({ "POST /auth/step-up": { status: 401 } });
    await expect(client.stepUp({ action: "contact" })).rejects.toThrow(/401/);
  });

  it("reads the outcome from the proxy, never from the address, and clears the id from it", async () => {
    const { href: _returnedTo, ...approved } = stepUpCheck.outcome;
    const calls = routes({ [`GET /auth/step-up/${id}`]: { status: 200, body: { stepUp: approved } } });
    const client = createRouteClient({ initialSession: session });

    window.history.replaceState(null, "", `/account/security?tab=email&step_up=${id}`);
    await expect(client.handleStepUpCallback()).resolves.toEqual(approved);
    expect(window.location.pathname + window.location.search).toBe("/account/security?tab=email");
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`GET /auth/step-up/${id}`]);
    await expect(client.handleStepUpCallback("/account?status=approved")).rejects.toThrow(/not a step-up/);
    expect(calls).toHaveLength(1);
  });
});

describe("headless sign-in", () => {
  // The code and verifier the browser core sent to token/ in the recording, now sent to this app's server.
  const grant = protection.exchanges.find((exchange: { request: { path: string } }) => exchange.request.path === "token/").request.body;

  beforeEach(() => jest.clearAllMocks());

  it("runs the steps on the browser core and lets this app's server exchange the code", async () => {
    const calls = routes({ "POST /auth/exchange": { status: 200, body: { session: recorded.session.body } } });
    const client = createRouteClient({ initialSession: null, publishableKey: ENV.DIDIT_PUBLISHABLE_KEY, redirectUri: ENV.DIDIT_REDIRECT_URI });

    core.password.signIn.mockResolvedValue(protection.challenged);
    // As the core does once its last step answers a code: hand it to exchangeCode, then report the session.
    core.protection.verify.mockImplementation(async () => {
      const body = await createDiditAuth.mock.calls[0][0].exchangeCode({ code: grant.code, codeVerifier: grant.code_verifier, redirectUri: grant.redirect_uri });

      return { status: "signed_in", session: { userId: (body as { sub: string }).sub } };
    });
    await expect(client.password.signIn({ email: protection.email, password: "secret" })).resolves.toEqual(protection.challenged);
    expect(createDiditAuth).toHaveBeenCalledWith({
      publishableKey: ENV.DIDIT_PUBLISHABLE_KEY,
      redirectUri: ENV.DIDIT_REDIRECT_URI,
      storage: "memory",
      exchangeCode: expect.any(Function)
    });
    expect(client.getSnapshot().status).toBe("signed-out");
    await expect(client.protection.verify({ code: protection.code })).resolves.toEqual({ status: "signed_in", session });
    expect(core.protection.verify).toHaveBeenCalledWith({ code: protection.code });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/auth/exchange", body: { code: grant.code, code_verifier: grant.code_verifier } });
    expect(calls[0].headers.get("x-didit-auth")).toBe("fetch");
    expect(client.getSnapshot()).toEqual({ status: "signed-in", session });
    expect(createDiditAuth).toHaveBeenCalledTimes(1);
  });

  it("stays signed out when this app's server refuses the code", async () => {
    routes({ "POST /auth/exchange": { status: 400, body: { error: "invalid_grant" } } });
    const client = createRouteClient({ initialSession: null, publishableKey: ENV.DIDIT_PUBLISHABLE_KEY, redirectUri: ENV.DIDIT_REDIRECT_URI });

    core.emailCode.verify.mockImplementation(() =>
      createDiditAuth.mock.calls[0][0].exchangeCode({ code: grant.code, codeVerifier: grant.code_verifier, redirectUri: grant.redirect_uri })
    );
    await expect(client.emailCode.verify({ code: "123456" })).rejects.toThrow(/400/);
    expect(client.getSnapshot().status).toBe("signed-out");
  });

  it("needs the key and callback the server <DiditAuth> passes", async () => {
    const client = createRouteClient({ initialSession: null });

    await expect(client.phone.start({ phone: "+14155550123" })).rejects.toThrow(/<DiditAuth>/);
    expect(createDiditAuth).not.toHaveBeenCalled();
  });
});
