/**
 * @jest-environment node
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { DiditAuthError as BrowserDiditAuthError } from "../index";
import { DiditAuthError, verifyToken } from "../server/index";
import { publishableKeyFor } from "./helpers/replay";

interface SigningKey {
  kid: string;
  privateKey: CryptoKey;
  jwk: JsonWebKey & { kid: string };
}

interface Tenant {
  applicationId: string;
  issuer: string;
  publishableKey: string;
  keys: SigningKey[];
  jwksStatus: number;
  jwksRequests: number;
  discoveryStatus: number;
  discoveryRequests: number;
  discovery?: Record<string, unknown>;
}

const tenants = new Map<string, Tenant>();
let server: Server;
let origin: string;

beforeAll(async () => {
  // Serves each tenant's OpenID discovery document and key set, as the issuer does.
  server = createServer((request, response) => {
    const match = /^\/auth\/v2\/authentication\/([^/]+)\/(\.well-known\/openid-configuration|jwks)$/.exec(request.url ?? "");
    const tenant = match && tenants.get(match[1]);
    if (!tenant) return void response.writeHead(404).end();
    if (match[2] === "jwks") {
      tenant.jwksRequests++;
      if (tenant.jwksStatus !== 200) return void response.writeHead(tenant.jwksStatus).end();
      return void response
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ keys: tenant.keys.map((key) => key.jwk) }));
    }
    tenant.discoveryRequests++;
    if (tenant.discoveryStatus !== 200) return void response.writeHead(tenant.discoveryStatus).end();
    response
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify(tenant.discovery ?? { issuer: tenant.issuer, jwks_uri: `${tenant.issuer}/jwks` }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
afterEach(() => {
  jest.restoreAllMocks();
});

async function signingKey(kid = randomUUID()): Promise<SigningKey> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const { kty, crv, x, y } = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { kid, privateKey: pair.privateKey, jwk: { kty, crv, x, y, kid, alg: "ES256", use: "sig" } };
}

async function tenant(): Promise<Tenant> {
  const applicationId = randomUUID();
  const issuer = `${origin}/auth/v2/authentication/${applicationId}`;
  const created: Tenant = {
    applicationId,
    issuer,
    publishableKey: publishableKeyFor(issuer),
    keys: [await signingKey()],
    jwksStatus: 200,
    jwksRequests: 0,
    discoveryStatus: 200,
    discoveryRequests: 0
  };
  tenants.set(applicationId, created);
  return created;
}

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

async function token(
  owner: Tenant,
  claims: Record<string, unknown> = {},
  { key = owner.keys[0], header = {} }: { key?: SigningKey; header?: Record<string, unknown> } = {}
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const input = `${encode({ alg: "ES256", typ: "JWT", kid: key.kid, ...header })}.${encode({
    iss: owner.issuer,
    aud: owner.applicationId,
    sub: "6e911151-6862-4541-851d-23ad36e85ed6",
    sid: "214de96d-95e1-47a2-8b0f-ccf3f9b1f170",
    vendor_data: "customer-7731",
    amr: ["passkey"],
    iat: now,
    exp: now + 300,
    ...claims
  })}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.privateKey, Buffer.from(input));
  return `${input}.${Buffer.from(signature).toString("base64url")}`;
}

async function rejection(promise: Promise<unknown>): Promise<DiditAuthError> {
  try {
    await promise;
  } catch (error) {
    return error as DiditAuthError;
  }
  throw new Error("expected a rejection");
}

describe("verifyToken", () => {
  it("returns the claims of a token signed by the application's issuer", async () => {
    const app = await tenant();
    const claims = await verifyToken(
      await token(app, { act: { agent_id: "d73d7dc9", agent: "Local Agent", scopes: ["read"] } }),
      { publishableKey: app.publishableKey }
    );

    expect(claims).toMatchObject({
      iss: app.issuer,
      aud: app.applicationId,
      sub: "6e911151-6862-4541-851d-23ad36e85ed6",
      vendor_data: "customer-7731",
      act: { agent: "Local Agent", scopes: ["read"] }
    });
  });

  it("shares one error class with the browser entry", async () => {
    expect(DiditAuthError).toBe(BrowserDiditAuthError);
  });

  it("rejects tokens of another application, another issuer or another audience", async () => {
    const app = await tenant();
    const other = await tenant();

    // Another tenant's genuine token: unknown key id for this issuer.
    expect((await rejection(verifyToken(await token(other), { publishableKey: app.publishableKey }))).code).toBe(
      "invalid_token"
    );
    // Forged with this tenant's key id but another tenant's key: the signature fails.
    const forged = await token(app, {}, { key: { ...other.keys[0], kid: app.keys[0].kid } });
    expect((await rejection(verifyToken(forged, { publishableKey: app.publishableKey }))).message).toMatch(/signature/);
    // Signed by this issuer's key but naming another issuer or audience.
    const wrongIssuer = await rejection(
      verifyToken(await token(app, { iss: other.issuer }), { publishableKey: app.publishableKey })
    );
    const wrongAudience = await rejection(
      verifyToken(await token(app, { aud: [other.applicationId] }), { publishableKey: app.publishableKey })
    );
    expect(wrongIssuer.message).toMatch(/another application/);
    expect(wrongAudience.message).toMatch(/another audience/);
    // A token naming several audiences passes when one of them is this application.
    await expect(
      verifyToken(await token(app, { aud: [other.applicationId, app.applicationId] }), { publishableKey: app.publishableKey })
    ).resolves.toMatchObject({ sub: expect.any(String) });
  });

  it("accepts only ES256 and refuses those tokens before fetching any key", async () => {
    const app = await tenant();
    const valid = await token(app);
    const [, payload, signature] = valid.split(".");

    for (const header of [{ alg: "none" }, { alg: "HS256" }, { alg: "RS256" }, { alg: "ES256" }, { alg: "ES256", kid: 7 }]) {
      const forged = `${encode({ typ: "JWT", ...header })}.${payload}.${header.alg === "none" ? "" : signature}`;
      expect((await rejection(verifyToken(forged, { publishableKey: app.publishableKey }))).code).toBe("invalid_token");
    }
    const critical = await token(app, {}, { header: { crit: ["exp"] } });
    expect((await rejection(verifyToken(critical, { publishableKey: app.publishableKey }))).code).toBe("invalid_token");
    expect(app.jwksRequests).toBe(0);
    for (const malformed of ["", "a.b", "a.b.c.d", `${valid}x`, `${valid.split(".")[0]}.@@.${signature}`]) {
      expect((await rejection(verifyToken(malformed, { publishableKey: app.publishableKey }))).code).toBe("invalid_token");
    }
  });

  it("rejects a token whose claims were changed after signing", async () => {
    const app = await tenant();
    const [header, , signature] = (await token(app)).split(".");
    const tampered = `${header}.${encode({ iss: app.issuer, aud: app.applicationId, sub: "someone-else", exp: 9e9 })}.${signature}`;

    expect((await rejection(verifyToken(tampered, { publishableKey: app.publishableKey }))).message).toMatch(/signature/);
  });

  it("checks expiry and not-before with a small clock tolerance", async () => {
    const app = await tenant();
    const now = Math.floor(Date.now() / 1000);
    const options = { publishableKey: app.publishableKey };

    expect((await rejection(verifyToken(await token(app, { exp: now - 6 }), options))).code).toBe("token_expired");
    await expect(verifyToken(await token(app, { exp: now - 3 }), options)).resolves.toBeTruthy();
    expect((await rejection(verifyToken(await token(app, { nbf: now + 60 }), options))).message).toMatch(/not valid yet/);
    await expect(verifyToken(await token(app, { exp: now - 30 }), { ...options, clockTolerance: 60 })).resolves.toBeTruthy();
    expect((await rejection(verifyToken(await token(app, { exp: undefined }), options))).code).toBe("invalid_token");
    expect((await rejection(verifyToken(await token(app, { sub: "" }), options))).code).toBe("invalid_token");
  });

  it("caches the keys and picks up a rotated key, at most once per cooldown for unknown ids", async () => {
    const app = await tenant();
    const options = { publishableKey: app.publishableKey };
    const now = Date.now();
    const clock = jest.spyOn(Date, "now");
    const current = app.keys[0];

    await verifyToken(await token(app), options);
    await verifyToken(await token(app), options);
    expect(app.jwksRequests).toBe(1);

    // Rotation with overlap: the issuer publishes the next key next to the current one.
    const next = await signingKey();
    app.keys.push(next);
    clock.mockReturnValue(now + 31_000);
    await expect(verifyToken(await token(app, {}, { key: next }), options)).resolves.toBeTruthy();
    expect(app.jwksRequests).toBe(2);

    // Unknown key ids cannot make every request reach the issuer.
    const stranger = await signingKey();
    expect((await rejection(verifyToken(await token(app, {}, { key: stranger }), options))).message).toMatch(/unknown key/);
    expect((await rejection(verifyToken(await token(app, {}, { key: stranger }), options))).code).toBe("invalid_token");
    expect(app.jwksRequests).toBe(2);
    clock.mockReturnValue(now + 62_000);
    await rejection(verifyToken(await token(app, {}, { key: stranger }), options));
    expect(app.jwksRequests).toBe(3);

    // Ten minutes after the last load the set is reloaded, so a retired key stops verifying.
    app.keys = [next];
    clock.mockReturnValue(now + 62_000 + 10 * 60_000);
    expect((await rejection(verifyToken(await token(app, {}, { key: current }), options))).message).toMatch(/unknown key/);
    expect(app.jwksRequests).toBe(4);
  });

  it("keeps the last good keys while the issuer is down, and reports when it has none", async () => {
    const app = await tenant();
    const options = { publishableKey: app.publishableKey };
    const now = Date.now();

    await verifyToken(await token(app), options);
    app.jwksStatus = 503;
    jest.spyOn(Date, "now").mockReturnValue(now + 11 * 60_000);
    await expect(verifyToken(await token(app), options)).resolves.toBeTruthy();

    const down = await tenant();
    down.jwksStatus = 500;
    expect((await rejection(verifyToken(await token(down), { publishableKey: down.publishableKey }))).code).toBe(
      "jwks_unavailable"
    );
  });

  it("shares one discovery request between concurrent tokens and waits a cooldown after the issuer fails", async () => {
    const app = await tenant();
    const options = { publishableKey: app.publishableKey };
    const now = Date.now();
    const clock = jest.spyOn(Date, "now").mockReturnValue(now);
    const tokens = await Promise.all([1, 2, 3, 4, 5].map(() => token(app)));

    // Five requests while the issuer is down: one discovery request between them, then none until the cooldown ends.
    app.discoveryStatus = 503;
    for (const failed of await Promise.all(tokens.map((value) => rejection(verifyToken(value, options))))) {
      expect(failed.code).toBe("jwks_unavailable");
    }
    expect(app.discoveryRequests).toBe(1);
    for (const value of tokens) expect((await rejection(verifyToken(value, options))).code).toBe("jwks_unavailable");
    expect(app.discoveryRequests).toBe(1);

    // Once the cooldown ends the next requests try again, sharing one discovery and one key set request.
    app.discoveryStatus = 200;
    clock.mockReturnValue(now + 6_000);
    await Promise.all(tokens.map((value) => verifyToken(value, options)));
    expect(app.discoveryRequests).toBe(2);
    expect(app.jwksRequests).toBe(1);

    // The address stays known while the issuer is down again after it expires.
    app.discoveryStatus = 503;
    clock.mockReturnValue(now + 6_000 + 10 * 60_000);
    await expect(verifyToken(tokens[0], options)).resolves.toBeTruthy();
    await expect(verifyToken(tokens[1], options)).resolves.toBeTruthy();
    expect(app.discoveryRequests).toBe(3);
  });

  it("refuses discovery documents that name another issuer or an insecure key address", async () => {
    const spoofed = await tenant();
    spoofed.discovery = { issuer: "https://attacker.example", jwks_uri: `${spoofed.issuer}/jwks` };
    const insecure = await tenant();
    insecure.discovery = { issuer: insecure.issuer, jwks_uri: "http://keys.example.com/jwks" };

    for (const app of [spoofed, insecure]) {
      expect((await rejection(verifyToken(await token(app), { publishableKey: app.publishableKey }))).code).toBe(
        "jwks_unavailable"
      );
      expect(app.jwksRequests).toBe(0);
    }
  });

  it("only imports P-256 signing keys", async () => {
    const app = await tenant();
    const key = app.keys[0];
    app.keys = [
      { ...key, jwk: { ...key.jwk, alg: "ES384" } },
      { ...key, jwk: { ...key.jwk, use: "enc" } },
      { ...key, jwk: { ...key.jwk, crv: "P-384" } }
    ];

    expect((await rejection(verifyToken(await token(app, {}, { key }), { publishableKey: app.publishableKey }))).message).toMatch(
      /unknown key/
    );
  });

  it("takes an explicit issuer, audience and key address", async () => {
    const app = await tenant();
    const claims = await verifyToken(await token(app, { aud: "my-api" }), {
      issuer: app.issuer,
      audience: ["my-api"],
      jwksUri: `${app.issuer}/jwks`
    });

    expect(claims.aud).toBe("my-api");
    await expect(verifyToken(await token(app), {})).rejects.toMatchObject({ code: "invalid_request" });
  });
});
