/**
 * The page of the recording: on the application's own host, where its passkeys run.
 *
 * @jest-environment-options {"url": "http://example-organization-8624eab576225049fa8a41515ba175d8.sandbox.auth.localhost:8766/e2e/fixtures/app.html"}
 */
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { createDiditAuth } from "../client";
import { fromBase64Url, toBase64Url } from "../encoding";
import type { PasskeyOptionsJSON } from "../webauthn";
import { loadFixture, replay, runtimeOf } from "./helpers/replay";

const PASSWORD = "Correct-horse-battery-91";

interface AssertionJSON {
  id: string;
  rawId: string;
  type: string;
  authenticatorAttachment?: string;
  clientExtensionResults: Record<string, unknown>;
  response: Record<"clientDataJSON" | "authenticatorData" | "signature" | "userHandle", string>;
}

const buffer = (value: string) => fromBase64Url(value).buffer;

/** The assertion the browser's authenticator returned during the recording, as a PublicKeyCredential. */
function recordedCredential(json: AssertionJSON): PublicKeyCredential {
  return {
    id: json.id,
    rawId: buffer(json.rawId),
    type: json.type,
    authenticatorAttachment: json.authenticatorAttachment ?? null,
    getClientExtensionResults: () => json.clientExtensionResults,
    response: {
      clientDataJSON: buffer(json.response.clientDataJSON),
      authenticatorData: buffer(json.response.authenticatorData),
      signature: buffer(json.response.signature),
      userHandle: buffer(json.response.userHandle)
    }
  } as unknown as PublicKeyCredential;
}

let restore: () => void = () => undefined;

beforeEach(() => {
  localStorage.clear();
  const credentials = Object.getOwnPropertyDescriptor(navigator, "credentials");
  Object.assign(globalThis, { PublicKeyCredential: function PublicKeyCredential() {} });
  restore = () => {
    delete (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential;
    if (credentials) Object.defineProperty(navigator, "credentials", credentials);
    else delete (navigator as { credentials?: unknown }).credentials;
  };
});
afterEach(() => {
  restore();
  jest.restoreAllMocks();
});

describe("bot and risk protection with a passkey", () => {
  it("offers the person's passkey and signs in with it", async () => {
    const fixture = loadFixture("protection-passkey");
    const api = replay(fixture);
    const auth = createDiditAuth({
      publishableKey: runtimeOf(fixture).publishableKey,
      fetch: api.fetch,
      deviceSignals: fixture.deviceSignals as "off"
    });
    const challenge = fixture.exchanges[11].response.body as { challenge: string; options: PasskeyOptionsJSON };
    const sent = fixture.exchanges[12].request.body as { response: AssertionJSON };
    const get = jest.fn(async (_options?: CredentialRequestOptions) => recordedCredential(sent.response));
    Object.defineProperty(navigator, "credentials", { configurable: true, value: { get } });
    const email = fixture.email as string;

    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(auth.password.signIn({ email, password: fixture.wrongPassword as string })).rejects.toMatchObject({
        code: "invalid_credentials"
      });
    }
    await expect(auth.password.signIn({ email, password: PASSWORD })).resolves.toEqual({
      status: "protection_required",
      methods: ["passkey", "email_code"],
      expiresIn: 300
    });
    const result = await auth.protection.passkey();

    // The browser was asked for exactly the passkey the challenge offered.
    const publicKey = get.mock.calls[0][0]?.publicKey as PublicKeyCredentialRequestOptions;
    expect(toBase64Url(publicKey.challenge as Uint8Array)).toBe(challenge.options.challenge);
    expect(publicKey.rpId).toBe(location.hostname);
    expect(toBase64Url(publicKey.allowCredentials?.[0].id as Uint8Array)).toBe(sent.response.id);
    expect(fixture.exchanges[12].request.body).toMatchObject({ challenge: challenge.challenge, method: "passkey" });
    // A passkey is a strong proof: it also counts as the second factor.
    expect(result.status).toBe("signed_in");
    expect(result.status === "signed_in" && result.session).toMatchObject({ email, mfaVerified: true });
    api.verify();
  });
});
