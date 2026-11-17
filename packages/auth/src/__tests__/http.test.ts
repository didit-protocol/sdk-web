import { describe, expect, it } from "@jest/globals";

import { DiditAuthError } from "../errors";
import { createHttpClient, toError } from "../http";
import { loadFixture, type Exchange } from "./helpers/replay";

function recorded(scenario: string, path: string): Exchange["response"] {
  const exchange = loadFixture(scenario).exchanges.find(
    (candidate) => candidate.request.path === path && candidate.response.status >= 400
  );
  if (!exchange) throw new Error(`${scenario} has no failed ${path}`);
  return exchange.response;
}

function mapped(scenario: string, path: string): DiditAuthError {
  const response = recorded(scenario, path);
  return toError(response.status, response.body as Record<string, unknown>);
}

describe("toError with recorded API errors", () => {
  it.each([
    ["wrong-password", "password/", "invalid_credentials", 400],
    ["email-code", "email/complete/", "invalid_grant", 400],
    ["invalid-redirect", "authorize/", "invalid_redirect_uri", 400],
    ["phone", "phone/start/", "delivery_unavailable", 503],
    ["agents", "agents/consent/", "passkey_required", 403],
    ["revoked-session", "session/", "invalid_token", 401],
    ["revoked-session", "token/", "invalid_grant", 400],
    ["rate-limited", "authorize/", "rate_limited", 429]
  ])("%s %s answers %s", (scenario, path, code, status) => {
    const error = mapped(scenario, path);

    expect(error).toBeInstanceOf(DiditAuthError);
    expect(error.name).toBe("DiditAuthError");
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
  });

  it("keeps per-field codes and names the error after them", () => {
    const weak = mapped("sign-up-weak-password", "email/start/");
    const phone = mapped("phone-invalid", "phone/start/");

    expect(weak.code).toBe("password_policy");
    expect(weak.fields).toEqual({ password: ["password_policy"] });
    expect(phone.code).toBe("invalid_phone");
    expect(phone.fields).toEqual({ phone: ["invalid_phone"] });
  });

  it("keeps the API's sentence as the message when it is prose", () => {
    expect(mapped("rate-limited", "authorize/").message).toMatch(/^Too many requests/);
  });

  it("falls back on the status for bodies without a code", () => {
    expect(toError(404, { detail: "Not found." }).code).toBe("not_found");
    expect(toError(500, null).code).toBe("server_error");
    expect(toError(401, null).code).toBe("invalid_token");
    expect(toError(400, { email: ["Enter a valid email address."] }).code).toBe("invalid_request");
    expect(toError(429, null, 60).retryAfter).toBe(60);
  });
});

describe("createHttpClient", () => {
  it("reports a request that never reached the API as network_error", async () => {
    const request = createHttpClient("https://auth.example.com/auth/v2/authentication/x", async () => {
      throw new TypeError("Failed to fetch");
    }, async () => ({}));

    await expect(request("session/")).rejects.toMatchObject({ code: "network_error", message: "Failed to fetch" });
  });
});
