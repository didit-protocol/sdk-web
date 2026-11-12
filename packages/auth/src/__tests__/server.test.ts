/**
 * @jest-environment node
 */
import { afterAll, afterEach, describe, expect, it, jest } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { DiditAuthError as BrowserDiditAuthError } from "../index";
import { DiditAuthError, verifyToken } from "../server/index";
import { loadFixture, publishableKeyFor } from "./helpers/replay";

interface SigningKey {
  kid: string;
  privateKey: CryptoKey;
  jwk: JsonWebKey & { kid: string };
}

interface Tenant {
  applicationId: string;
  server: Server;
  issuer: string;
  publishableKey: string;
  keys: SigningKey[];
  jwksStatus: number;
  jwksRequests: number;
  discoveryStatus: number;
  discoveryRequests: number;
  discovery?: Record<string, unknown>;
}

const tenants: Tenant[] = [];

afterAll(() => Promise.all(tenants.map(({ server }) => new Promise<void>((resolve) => server.close(() => resolve())))));
afterEach(() => {
  jest.restoreAllMocks();
});

// Every application is its own issuer, at its own origin: this one's discovery document and key set.
function serve(tenant: Tenant): Server {
  return createServer((request, response) => {
    const route = /^\/(\.well-known\/openid-configuration|jwks)$/.exec(request.url ?? "")?.[1];
    if (!route) return void response.writeHead(404).end();
    if (route === "jwks") {
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
}

async function signingKey(kid = randomUUID()): Promise<SigningKey> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const { kty, crv, x, y } = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { kid, privateKey: pair.privateKey, jwk: { kty, crv, x, y, kid, alg: "ES256", use: "sig" } };
}

async function tenant(): Promise<Tenant> {
  const created = {
    applicationId: randomUUID(),
    keys: [await signingKey()],
    jwksStatus: 200,
    jwksRequests: 0,
    discoveryStatus: 200,
    discoveryRequests: 0
  } as Tenant;
  created.server = serve(created);
  await new Promise<void>((resolve) => created.server.listen(0, "127.0.0.1", resolve));
  created.issuer = `http://127.0.0.1:${(created.server.address() as AddressInfo).port}`;
  created.publishableKey = publishableKeyFor(created.issuer);
  tenants.push(created);
  return created;
}

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

async function token(
  owner: Tenant,
  claims: Record<string, unknown> = {},
  { key = owner.keys[0], header = {} }: { key?: SigningKey; header?: Record<string, unknown> } = {}
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const input = `${encode({ alg: "ES256", typ: "at+jwt", kid: key.kid, ...header })}.${encode({
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

/** What the local Didit auth service issued and published (fixtures/issuer.json, fixtures/step-up-check.json). */
function issued() {
  const issuer = loadFixture("issuer") as unknown as {
    origin: string;
    publishableKey: string;
    applicationId: string;
    discovery: Record<string, unknown>;
    jwks: Record<string, unknown>;
  };
  const tokens = loadFixture("step-up-check").exchanges.find(({ request }) => request.path === "token/")?.response
    .body as { access_token: string; id_token: string };
  const published: Record<string, unknown> = {
    [`${issuer.origin}/.well-known/openid-configuration`]: issuer.discovery,
    [issuer.discovery.jwks_uri as string]: issuer.jwks
  };
  const fetch = jest.fn(async (url: string) => {
    if (!published[url]) return { ok: false, status: 404, json: async () => ({}) } as Response;
    return { ok: true, status: 200, json: async () => published[url] } as Response;
  });
  // The recorded token's own clock: issued a moment ago, five minutes before it expires.
  const { iat } = JSON.parse(Buffer.from(tokens.access_token.split(".")[1], "base64url").toString());
  jest.spyOn(Date, "now").mockReturnValue((iat + 1) * 1000);
  return { ...issuer, ...tokens, fetch: fetch as unknown as typeof globalThis.fetch };
}

describe("verifyToken", () => {
  it("verifies an access token the Didit auth service issued, with the publishable key it minted", async () => {
    const service = issued();
    const claims = await verifyToken(service.access_token, { publishableKey: service.publishableKey, fetch: service.fetch });

    // The key names the application's origin, which is the issuer of its tokens.
    expect(claims).toMatchObject({ iss: service.origin, aud: service.applicationId, act: null });
    expect(service.fetch).toHaveBeenCalledWith(`${service.origin}/.well-known/openid-configuration`, expect.anything());
    await expect(
      verifyToken(service.access_token, {
        publishableKey: service.publishableKey,
        audience: service.applicationId,
        fetch: service.fetch
      })
    ).resolves.toMatchObject({ sub: claims.sub });
    // The ID token the service issued with it has the same issuer, audience and keys.
    expect(
      await rejection(verifyToken(service.id_token, { publishableKey: service.publishableKey, fetch: service.fetch }))
    ).toMatchObject({ code: "invalid_token", message: expect.stringMatching(/not an access token/) });
  });

  it("returns the claims of a token signed by the application's issuer", async () => {
    const app = await tenant();
    const claims = await verifyToken(
      await token(app, { org: null, act: { sub: "d73d7dc9", agent: "Local Agent", scopes: ["read"] } }),
      { publishableKey: app.publishableKey }
    );

    expect(claims).toMatchObject({
      iss: app.issuer,
      aud: app.applicationId,
      sub: "6e911151-6862-4541-851d-23ad36e85ed6",
      vendor_data: "customer-7731",
      org: null,
      act: { sub: "d73d7dc9", agent: "Local Agent", scopes: ["read"] }
    });
  });

  it("shares one error class with the browser entry", async () => {
    expect(DiditAuthError).toBe(BrowserDiditAuthError);
  });

  it("rejects tokens of another application or another issuer, and of another audience when one is given", async () => {
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
    // The publishable key names the issuer, not the application id: pass it as the audience to check `aud` too.
    const audience = { publishableKey: app.publishableKey, audience: app.applicationId };
    const wrongAudience = await rejection(verifyToken(await token(app, { aud: [other.applicationId] }), audience));
    expect(wrongIssuer.message).toMatch(/another application/);
    expect(wrongAudience.message).toMatch(/another audience/);
    // A token naming several audiences passes when one of them is this application.
    await expect(
      verifyToken(await token(app, { aud: [other.applicationId, app.applicationId] }), audience)
    ).resolves.toMatchObject({ sub: expect.any(String) });
  });

  it("accepts only ES256 and refuses those tokens before fetching any key", async () => {
    const app = await tenant();
    const valid = await token(app);
    const [, payload, signature] = valid.split(".");

    for (const header of [{ alg: "none" }, { alg: "HS256" }, { alg: "RS256" }, { alg: "ES256" }, { alg: "ES256", kid: 7 }]) {
      const forged = `${encode({ typ: "at+jwt", ...header })}.${payload}.${header.alg === "none" ? "" : signature}`;
      expect((await rejection(verifyToken(forged, { publishableKey: app.publishableKey }))).code).toBe("invalid_token");
    }
    const critical = await token(app, {}, { header: { crit: ["exp"] } });
    expect((await rejection(verifyToken(critical, { publishableKey: app.publishableKey }))).code).toBe("invalid_token");
    expect(app.jwksRequests).toBe(0);
    for (const malformed of ["", "a.b", "a.b.c.d", `${valid}x`, `${valid.split(".")[0]}.@@.${signature}`]) {
      expect((await rejection(verifyToken(malformed, { publishableKey: app.publishableKey }))).code).toBe("invalid_token");
    }
  });

  it("refuses an ID token of the same issuer and anything else that is not an access token", async () => {
    const app = await tenant();
    const options = { publishableKey: app.publishableKey };

    // The issuer signs the ID token with the same key, issuer, audience and subject; only the type differs.
    const idToken = await token(app, { email: "person@example.com" }, { header: { typ: "JWT" } });
    expect(await rejection(verifyToken(idToken, options))).toMatchObject({
      code: "invalid_token",
      message: expect.stringMatching(/not an access token/)
    });
    for (const typ of [undefined, "", "dpop+jwt", ["at+jwt"]]) {
      expect((await rejection(verifyToken(await token(app, {}, { header: { typ } }), options))).code).toBe("invalid_token");
    }
    expect(app.jwksRequests).toBe(0);
    await expect(verifyToken(await token(app, {}, { header: { typ: "application/at+jwt" } }), options)).resolves.toMatchObject({
      sub: expect.any(String)
    });
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
    await expect(verifyToken(await token(app), options)).resolves.toBeTruthy();
    await expect(verifyToken(await token(app), options)).resolves.toBeTruthy();
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
