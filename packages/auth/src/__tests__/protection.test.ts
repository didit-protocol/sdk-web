import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { createDiditAuth } from "../client";
import { loadFixture, replay, runtimeOf } from "./helpers/replay";

const PASSWORD = "Correct-horse-battery-91";

beforeEach(() => localStorage.clear());
afterEach(() => {
  jest.restoreAllMocks();
});

describe("bot and risk protection", () => {
  it("asks for an emailed code after repeated wrong passwords, and signs in once it is given", async () => {
    const fixture = loadFixture("protection-email-code");
    const api = replay(fixture);
    const auth = createDiditAuth({ publishableKey: runtimeOf(fixture).publishableKey, fetch: api.fetch });
    const email = fixture.email as string;

    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(auth.password.signIn({ email, password: fixture.wrongPassword as string })).rejects.toMatchObject({
        code: "invalid_credentials"
      });
    }
    // The application challenges brute-force attempts: the right password now needs one more proof.
    await expect(auth.password.signIn({ email, password: PASSWORD })).resolves.toEqual({
      status: "protection_required",
      methods: ["email_code"],
      expiresIn: 300
    });

    // It is not an MFA step, and this person has no passkey to give.
    await expect(auth.mfa.verify({ code: fixture.code as string })).rejects.toMatchObject({ code: "no_pending_attempt" });
    await expect(auth.protection.passkey()).rejects.toMatchObject({ code: "method_unavailable" });
    await expect(auth.protection.verify({ code: fixture.wrongCode as string })).rejects.toMatchObject({
      code: "invalid_grant",
      status: 400
    });
    const result = await auth.protection.verify({ code: fixture.code as string });

    expect(result.status).toBe("signed_in");
    expect(result.status === "signed_in" && result.session).toMatchObject({ email, methods: ["password"], mfaVerified: false });
    const [wrong, right] = fixture.exchanges.filter(({ request }) => request.path === "protection/complete/");
    expect(wrong.request.body).toEqual({
      challenge: (fixture.exchanges[11].response.body as { challenge: string }).challenge,
      method: "email_code",
      code: fixture.wrongCode
    });
    expect(right.request.body).toMatchObject({ method: "email_code", code: fixture.code });
    api.verify();
  });

  it("needs a sign-in that asked for protection first", async () => {
    const fixture = loadFixture("protection-email-code");
    const api = replay(fixture);
    const auth = createDiditAuth({ publishableKey: runtimeOf(fixture).publishableKey, fetch: api.fetch });

    await expect(auth.protection.verify({ code: "123456" })).rejects.toMatchObject({ code: "no_pending_attempt" });
    await expect(auth.protection.passkey()).rejects.toMatchObject({ code: "no_pending_attempt" });
    api.verify(0);
  });
});
