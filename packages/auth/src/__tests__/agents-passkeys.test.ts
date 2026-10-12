import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { createDiditAuth } from "../client";
import { toBase64Url } from "../encoding";
import { assertPasskeysAvailable, creationOptions, credentialJSON, requestOptions } from "../webauthn";
import { loadFixture, publishableKeyFor, replay } from "./helpers/replay";

const PASSWORD = "Correct-horse-battery-91";

function setup(name: string) {
  const fixture = loadFixture(name);
  const api = replay(fixture);
  const auth = createDiditAuth({ publishableKey: publishableKeyFor(fixture.apiBase), fetch: api.fetch });
  return { fixture, api, auth };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  jest.restoreAllMocks();
});

describe("agents", () => {
  it("lists, approves, denies and revokes agent access for the signed-in person", async () => {
    const { fixture, api, auth } = setup("agents");

    await auth.password.signIn({ email: "person@example.com", password: PASSWORD });
    await expect(auth.agents.list()).resolves.toEqual([]);

    // The application's policy asks for a passkey session before approving.
    await expect(
      auth.agents.consent({ challenge: fixture.passkeyChallenge as string, decision: "approve" })
    ).rejects.toMatchObject({ code: "passkey_required", status: 403 });
    await expect(auth.agents.consent({ challenge: fixture.denyChallenge as string, decision: "deny" })).resolves.toEqual({
      status: "denied"
    });

    const approved = await auth.agents.consent({ challenge: fixture.approveChallenge as string, decision: "approve" });
    expect(approved.status).toBe("approved");
    const redirect = new URL(approved.status === "approved" ? approved.redirectTo : "");
    expect(redirect.origin + redirect.pathname).toBe("http://localhost:4174/agent-callback");
    expect(redirect.searchParams.get("state")).toBe("agent-state-3");
    expect(redirect.searchParams.get("code")).toBeTruthy();

    const [grant] = await auth.agents.list();
    expect(grant).toMatchObject({ agentName: "Local Agent", scopes: ["read"], revokedAt: null });
    await auth.agents.revoke(grant.id);
    const [revoked] = await auth.agents.list();
    expect(revoked.id).toBe(grant.id);
    expect(revoked.revokedAt).toEqual(expect.any(String));
    api.verify();
  });

  it("needs a signed-in person", async () => {
    const { api, auth } = setup("agents");

    await expect(auth.agents.list()).rejects.toMatchObject({ code: "not_signed_in" });
    await expect(auth.passkeys.register()).rejects.toMatchObject({ code: "not_signed_in" });
    await expect(auth.mfa.enroll()).rejects.toMatchObject({ code: "not_signed_in" });
    api.verify(0);
  });
});

describe("passkeys", () => {
  it("starts a passkey sign-in and stops where the browser cannot run the ceremony", async () => {
    const { fixture, api, auth } = setup("passkey-begin");

    // jsdom has no WebAuthn; real browsers run the ceremony in the Playwright suite.
    await expect(auth.passkeys.signIn()).rejects.toMatchObject({ code: "passkey_unavailable" });
    expect((fixture.exchanges[1].response.body as { options: { rpId: string } }).options.rpId).toBe("localhost");
    api.verify();
  });

  it("only runs on the relying party's host or its subdomains", () => {
    const credentials = Object.getOwnPropertyDescriptor(navigator, "credentials");
    Object.defineProperty(navigator, "credentials", { configurable: true, value: {} });
    Object.assign(globalThis, { PublicKeyCredential: function PublicKeyCredential() {} });
    try {
      expect(() => assertPasskeysAvailable("localhost")).not.toThrow();
      expect(() => assertPasskeysAvailable("auth.didit.me")).toThrow(expect.objectContaining({ code: "passkey_unavailable" }));
      expect(() => assertPasskeysAvailable(undefined)).toThrow(expect.objectContaining({ code: "passkey_unavailable" }));
    } finally {
      delete (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential;
      if (credentials) Object.defineProperty(navigator, "credentials", credentials);
      else delete (navigator as { credentials?: unknown }).credentials;
    }
  });

  it("decodes the API's options into WebAuthn buffers", () => {
    const options = loadFixture("passkey-begin").exchanges[1].response.body as { options: never };
    const request = requestOptions(options.options);

    expect(request.challenge).toBeInstanceOf(Uint8Array);
    expect(toBase64Url(request.challenge as Uint8Array)).toBe((options.options as { challenge: string }).challenge);
    expect(request.rpId).toBe("localhost");
    expect(request.userVerification).toBe("required");

    const creation = creationOptions({
      challenge: "AAEC",
      rp: { id: "localhost", name: "Local Test App" },
      user: { id: "AQID", name: "person@example.com", displayName: "person@example.com" },
      excludeCredentials: [{ id: "BAUG", type: "public-key" }]
    });
    expect(Array.from(creation.user.id as Uint8Array)).toEqual([1, 2, 3]);
    expect(Array.from(creation.excludeCredentials?.[0].id as Uint8Array)).toEqual([4, 5, 6]);
  });

  it("encodes assertions and attestations the way the API parses them", () => {
    const bytes = (...values: number[]) => Uint8Array.from(values).buffer;
    const assertion = credentialJSON({
      id: "AQI",
      rawId: bytes(1, 2),
      type: "public-key",
      authenticatorAttachment: "platform",
      getClientExtensionResults: () => ({}),
      response: { clientDataJSON: bytes(3), authenticatorData: bytes(4), signature: bytes(5), userHandle: bytes(6) }
    } as unknown as PublicKeyCredential);
    const attestation = credentialJSON({
      id: "AQI",
      rawId: bytes(1, 2),
      type: "public-key",
      authenticatorAttachment: null,
      getClientExtensionResults: () => ({ credProps: { rk: true } }),
      response: { clientDataJSON: bytes(3), attestationObject: bytes(7), getTransports: () => ["internal"] }
    } as unknown as PublicKeyCredential);

    expect(assertion).toEqual({
      id: "AQI",
      rawId: "AQI",
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
      response: { clientDataJSON: "Aw", authenticatorData: "BA", signature: "BQ", userHandle: "Bg" }
    });
    expect(attestation).toEqual({
      id: "AQI",
      rawId: "AQI",
      type: "public-key",
      clientExtensionResults: { credProps: { rk: true } },
      response: { clientDataJSON: "Aw", attestationObject: "Bw", transports: ["internal"] }
    });
  });
});
