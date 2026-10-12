/**
 * @jest-environment jsdom
 */
import { createRouteClient } from "../client/route-client";
import { toGrant, toSession } from "../server/runtime-api";
import { recorded } from "./replay";

const session = toSession(recorded.session.body);
const grants = recorded.grants.body.results.map(toGrant);

function routes(answers: Record<string, { status: number; body?: unknown }>) {
  const calls: { method: string; path: string; headers: Headers }[] = [];

  global.fetch = jest.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const path = String(input);

    calls.push({ method, path, headers: new Headers(init.headers) });
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
    await client.stepUp();
    expect(navigate.mock.calls.map(([url]) => url)).toEqual([
      "/auth/sign-in?redirect_url=%2Fpricing%3Fplan%3Dpro",
      "/auth/sign-up?redirect_url=%2Fwelcome",
      "/auth/step-up?redirect_url=%2Fpricing%3Fplan%3Dpro"
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
