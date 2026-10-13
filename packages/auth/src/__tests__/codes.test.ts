import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { createDiditAuth } from "../client";
import type { DiditAuthOptions } from "../types";
import { loadFixture, publishableKeyFor, replay } from "./helpers/replay";

const PASSWORD = "Correct-horse-battery-91";

function setup(name: string, options: Partial<DiditAuthOptions> = {}) {
  const fixture = loadFixture(name);
  const api = replay(fixture);
  const auth = createDiditAuth({ publishableKey: publishableKeyFor(fixture.apiBase), fetch: api.fetch, ...options });
  return { fixture, api, auth };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  jest.restoreAllMocks();
});

describe("email codes", () => {
  it("signs in with the emailed code after a wrong attempt", async () => {
    const { fixture, api, auth } = setup("email-code");

    await expect(auth.emailCode.start({ email: "person@example.com" })).resolves.toEqual({
      status: "code_sent",
      expiresIn: 600
    });
    await expect(auth.emailCode.verify({ code: fixture.wrongCode as string })).rejects.toMatchObject({
      code: "invalid_grant"
    });
    const result = await auth.emailCode.verify({ code: fixture.code as string });

    expect(result.status === "signed_in" && result.session.methods).toEqual(["code"]);
    api.verify();
  });

  it("asks to start before a code is submitted", async () => {
    const { api, auth } = setup("email-code");

    await expect(auth.emailCode.verify({ code: "123456" })).rejects.toMatchObject({ code: "no_pending_attempt" });
    await expect(auth.phone.verify({ code: "123456" })).rejects.toMatchObject({ code: "no_pending_attempt" });
    await expect(auth.mfa.verify({ code: "123456" })).rejects.toMatchObject({ code: "no_pending_attempt" });
    await expect(auth.mfa.setup({ code: "123456" })).rejects.toMatchObject({ code: "no_pending_attempt" });
    await expect(auth.mfa.confirm({ code: "123456" })).rejects.toMatchObject({ code: "no_pending_attempt" });
    api.verify(0);
  });
});

describe("sign-up", () => {
  it("creates the account once the address is proven", async () => {
    const { fixture, api, auth } = setup("sign-up");

    await expect(auth.password.signUp({ email: "new-person@example.com", password: PASSWORD })).resolves.toEqual({
      status: "code_sent",
      expiresIn: 600
    });
    const result = await auth.emailCode.verify({ code: fixture.code as string });

    expect(result.status === "signed_in" && result.session).toMatchObject({
      email: "new-person@example.com",
      emailVerified: true,
      methods: ["password"]
    });
    api.verify();
  });

  it("reports the application's password policy", async () => {
    const { api, auth } = setup("sign-up-weak-password");

    await expect(auth.password.signUp({ email: "weak@example.com", password: "password" })).rejects.toMatchObject({
      code: "password_policy",
      fields: { password: ["password_policy"] }
    });
    api.verify();
  });

  it("requests a password reset email", async () => {
    const { api, auth } = setup("password-reset");

    await expect(auth.password.requestReset({ email: "person@example.com" })).resolves.toEqual({ expiresIn: 1800 });
    api.verify();
  });
});

describe("phone", () => {
  it("reports that codes cannot be delivered", async () => {
    const { api, auth } = setup("phone");

    await expect(auth.phone.start({ phone: "+14155550123" })).rejects.toMatchObject({
      code: "delivery_unavailable",
      status: 503
    });
    api.verify();
  });

  it("reports an invalid number", async () => {
    const { api, auth } = setup("phone-invalid");

    await expect(auth.phone.start({ phone: "123" })).rejects.toMatchObject({
      code: "invalid_phone",
      fields: { phone: ["invalid_phone"] }
    });
    api.verify();
  });
});

describe("multi-factor authentication", () => {
  it("completes a sign-in with an authenticator code after a wrong one", async () => {
    const { fixture, api, auth } = setup("mfa-sign-in");

    await expect(auth.password.signIn({ email: "mfa-person@example.com", password: PASSWORD })).resolves.toEqual({
      status: "mfa_required"
    });
    await expect(auth.mfa.verify({ code: fixture.wrongCode as string })).rejects.toMatchObject({ code: "invalid_grant" });
    const result = await auth.mfa.verify({ code: fixture.code as string });

    expect(result.status === "signed_in" && result.session.mfaVerified).toBe(true);
    api.verify();
  });

  it("has the person add an authenticator when the policy requires one, and returns the recovery codes", async () => {
    const { fixture, api, auth } = setup("mfa-enrollment-required");

    const first = await auth.password.signIn({ email: "setup-person@example.com", password: PASSWORD });
    expect(first.status).toBe("mfa_enrollment_required");
    expect(first.status === "mfa_enrollment_required" && first.uri).toMatch(/^otpauth:\/\/totp\//);

    const result = await auth.mfa.setup({ code: fixture.code as string });
    expect(result.status).toBe("signed_in");
    expect(result.status === "signed_in" && result.recoveryCodes).toHaveLength(10);
    expect(result.status === "signed_in" && result.session.mfaVerified).toBe(true);
    api.verify();
  });

  it("adds an authenticator to the signed-in person", async () => {
    const { fixture, api, auth } = setup("mfa-enroll");

    await auth.password.signIn({ email: "new-person@example.com", password: PASSWORD });
    const { uri } = await auth.mfa.enroll();
    expect(uri).toMatch(/^otpauth:\/\/totp\/.*secret=/);
    const { recoveryCodes } = await auth.mfa.confirm({ code: fixture.code as string });

    expect(recoveryCodes).toHaveLength(10);
    api.verify();
  });
});
