import { resolveConfig } from "../server/config";
import {
  DiditAuthApiError,
  endSession,
  exchangeCode,
  fetchSession,
  listGrants,
  refreshTokens,
  revokeGrant,
  toSession
} from "../server/runtime-api";
import { ENV, recorded, replay } from "./replay";
import grantPages from "./fixtures/grants-pages.json";

const config = resolveConfig(ENV);

describe("runtime API", () => {
  it("exchanges a code with the verifier, the registered redirect and the browser's user agent", async () => {
    const { calls } = replay({ method: "POST", path: "token/", response: recorded.tokenIssued });
    const tokens = await exchangeCode(config, { code: "code", verifier: "v".repeat(43), userAgent: "Browser/1.0" });

    expect(tokens).toEqual({
      accessToken: recorded.tokenIssued.body.access_token,
      refreshToken: recorded.tokenIssued.body.refresh_token,
      expiresIn: 299,
      sessionId: recorded.tokenIssued.body.session_id
    });
    expect(calls[0].body).toEqual({
      grant_type: "authorization_code",
      code: "code",
      code_verifier: "v".repeat(43),
      redirect_uri: ENV.DIDIT_REDIRECT_URI
    });
    expect(calls[0].headers.get("user-agent")).toBe("Browser/1.0");
  });

  it("reports a spent grant as invalid_grant", async () => {
    replay({ method: "POST", path: "token/", response: recorded.tokenInvalidGrant });
    const error = await refreshTokens(config, "spent").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DiditAuthApiError);
    expect(error).toMatchObject({ status: 400, code: "invalid_grant", invalidGrant: true });
  });

  it("maps the session and answers null for an invalid token", async () => {
    replay(
      { method: "GET", path: "session/", response: recorded.session },
      { method: "GET", path: "session/", response: recorded.sessionInvalid }
    );

    await expect(fetchSession(config, "good")).resolves.toEqual({
      id: recorded.session.body.sid,
      user: {
        id: recorded.session.body.sub,
        email: "person@example.com",
        emailVerified: true,
        phone: null,
        vendorData: null,
        verifiedIdentity: null,
        organizations: []
      },
      methods: ["password"],
      mfaVerified: false,
      expiresAt: recorded.session.body.expires_at
    });
    await expect(fetchSession(config, "gone")).resolves.toBeNull();
  });

  it("maps organizations, vendor data and verified claims when they are present", () => {
    const session = toSession({
      ...recorded.session.body,
      vendor_data: "user-42",
      verified_identity: { age_over_18: true },
      organizations: [{ organization_id: "org", organization__name: "Team", role: "admin" }]
    });

    expect(session.user.vendorData).toBe("user-42");
    expect(session.user.verifiedIdentity).toEqual({ age_over_18: true });
    expect(session.user.organizations).toEqual([{ id: "org", name: "Team", role: "admin" }]);
  });

  it("sends the access token as a bearer token and maps agent grants", async () => {
    const { calls } = replay(
      { method: "GET", path: "grants/?limit=100", response: recorded.grants },
      { method: "DELETE", path: `grants/${recorded.grants.body.results[0].id}/`, response: recorded.grantRevoked },
      { method: "DELETE", path: "session/", response: recorded.sessionEnded }
    );
    const grants = await listGrants(config, "token");

    expect(grants[0]).toEqual({
      id: recorded.grants.body.results[0].id,
      agentId: recorded.grants.body.results[0].agent_id,
      agentName: "Nova",
      scopes: ["balance:read", "settings:write", "payouts:request"],
      expiresAt: recorded.grants.body.results[0].expires_at,
      revokedAt: null
    });
    await revokeGrant(config, "token", grants[0].id);
    await endSession(config, "token");
    calls.forEach((call) => expect(call.headers.get("authorization")).toBe("Bearer token"));
  });

  it("fails on an unknown grant", async () => {
    replay({ method: "DELETE", path: "grants/00000000-0000-4000-8000-0000000000ff/", response: recorded.grantMissing });

    await expect(revokeGrant(config, "token", "00000000-0000-4000-8000-0000000000ff")).rejects.toMatchObject({ status: 404 });
  });
  it("reads every page without following response-provided URLs", async () => {
    const { calls, remaining } = replay(
      { method: "GET", path: "grants/?limit=100", response: grantPages.pages[0] },
      { method: "GET", path: "grants/?limit=100&offset=100", response: grantPages.pages[1] }
    );
    const grants = await listGrants(config, "token");

    expect(grants).toHaveLength(101);
    expect(grants[100].id).toBe(grantPages.pages[1].body.results[0].id);
    expect(new Set(grants.map(grant => grant.id)).size).toBe(101);
    expect(remaining()).toEqual([]);
    expect(calls).toHaveLength(2);
  });

});
