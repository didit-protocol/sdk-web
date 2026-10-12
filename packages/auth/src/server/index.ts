import { decodeText, fromBase64Url } from "../encoding";
import { DiditAuthError } from "../errors";
import { parsePublishableKey } from "../key";

export { DiditAuthError } from "../errors";
export type { DiditAuthErrorCode } from "../errors";

export interface VerifyTokenOptions {
  /** Derives the expected issuer and audience from the application's publishable key. */
  publishableKey?: string;
  /** Expected `iss`. Overrides the one derived from the publishable key. */
  issuer?: string;
  /** Accepted `aud` values. Overrides the application id derived from the publishable key. */
  audience?: string | string[];
  /** Signing keys address. Defaults to the `jwks_uri` of the issuer's OpenID discovery document. */
  jwksUri?: string;
  /** Accepted clock skew, in seconds, for `exp` and `nbf`. Defaults to 5. */
  clockTolerance?: number;
  /** A fetch implementation, for runtimes without a global one. */
  fetch?: typeof fetch;
}

/** Claims of a Didit access token. */
export interface DiditTokenClaims {
  iss: string;
  /** The person's Didit identity id. */
  sub: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nbf?: number;
  /** The session id. */
  sid?: string;
  /** The id that ties the person to their verifications and transactions. */
  vendor_data?: string;
  /** How the session was created. */
  amr?: string[];
  /** The person's organization when customer organizations are on, otherwise null. */
  org?: { id: string; role: string } | null;
  verified?: Record<string, unknown>;
  /** The AI agent acting for the person (`sub` is the agent id), or null when the person signed in. */
  act?: { sub: string; agent: string; scopes: string[] } | null;
  [claim: string]: unknown;
}

/** Something loaded from the issuer: the discovered key address, or the key set itself. */
interface Cached<T> {
  value?: T;
  loadedAt: number;
  retryAt: number;
  pending?: Promise<void>;
}

// Both are reloaded after ten minutes, and keys sooner when a token names a key
// this process has not seen (rotation). Loads happen at most once per cooldown,
// so neither unknown key ids nor an unreachable issuer can make every request hit it.
const KEYS_TTL_MS = 10 * 60_000;
const COOLDOWN_AFTER_LOAD_MS = 30_000;
const COOLDOWN_AFTER_FAILURE_MS = 5_000;
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
// RFC 9068 section 4: an access token is typed "at+jwt", or the full media type.
const ACCESS_TOKEN_TYPES = ["at+jwt", "application/at+jwt"];

const discovered = new Map<string, Cached<string>>();
const keySets = new Map<string, Cached<Map<string, CryptoKey>>>();

function invalid(message: string): DiditAuthError {
  return new DiditAuthError("invalid_token", message, { status: 401 });
}

function trustedUrl(value: unknown): value is string {
  try {
    const url = new URL(value as string);
    return url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname));
  } catch {
    return false;
  }
}

async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  try {
    const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    throw new DiditAuthError("jwks_unavailable", `Could not load ${url}: ${(error as Error).message}`);
  }
}

function cacheEntry<T>(cache: Map<string, Cached<T>>, id: string): Cached<T> {
  let entry = cache.get(id);
  if (!entry) cache.set(id, (entry = { loadedAt: 0, retryAt: 0 }));
  return entry;
}

// Concurrent callers share one load. Until a cooldown ends nobody reaches the issuer again:
// they get the last good value, which is kept while the issuer is unreachable, or an error.
async function cachedLoad<T>(entry: Cached<T>, due: boolean, load: () => Promise<T>): Promise<T> {
  if (due && Date.now() >= entry.retryAt) {
    entry.pending ??= load()
      .then(
        (value) => {
          entry.value = value;
          entry.loadedAt = Date.now();
          entry.retryAt = entry.loadedAt + COOLDOWN_AFTER_LOAD_MS;
        },
        (error) => {
          entry.retryAt = Date.now() + COOLDOWN_AFTER_FAILURE_MS;
          throw error;
        }
      )
      .finally(() => {
        entry.pending = undefined;
      });
    try {
      await entry.pending;
    } catch (error) {
      if (entry.value === undefined) throw error;
    }
  }
  if (entry.value === undefined) throw new DiditAuthError("jwks_unavailable", "The issuer's signing keys are not available.");
  return entry.value;
}

function jwksUriFor(issuer: string, fetchImpl: typeof fetch): Promise<string> {
  const entry = cacheEntry(discovered, issuer);

  return cachedLoad(entry, Date.now() - entry.loadedAt >= KEYS_TTL_MS, async () => {
    const document = await fetchJson(`${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`, fetchImpl);
    if (document.issuer !== issuer || !trustedUrl(document.jwks_uri)) {
      throw new DiditAuthError("jwks_unavailable", "The discovery document does not belong to this issuer.");
    }
    return document.jwks_uri;
  });
}

async function importKeys(jwksUri: string, fetchImpl: typeof fetch): Promise<Map<string, CryptoKey>> {
  const jwks = await fetchJson(jwksUri, fetchImpl);
  const keys = new Map<string, CryptoKey>();

  for (const jwk of Array.isArray(jwks.keys) ? jwks.keys : []) {
    if (
      jwk?.kty !== "EC" ||
      jwk.crv !== "P-256" ||
      typeof jwk.kid !== "string" ||
      typeof jwk.x !== "string" ||
      typeof jwk.y !== "string" ||
      (jwk.alg !== undefined && jwk.alg !== "ES256") ||
      (jwk.use !== undefined && jwk.use !== "sig")
    ) {
      continue;
    }
    try {
      // Only the public coordinates: never import anything else a key set may carry.
      const publicJwk = { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
      keys.set(jwk.kid, await crypto.subtle.importKey("jwk", publicJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]));
    } catch {
      // A malformed key is skipped; tokens it signed fail as signed by an unknown key.
    }
  }
  return keys;
}

async function signingKey(jwksUri: string, kid: string, fetchImpl: typeof fetch): Promise<CryptoKey | undefined> {
  const entry = cacheEntry(keySets, jwksUri);
  const due = Date.now() - entry.loadedAt >= KEYS_TTL_MS || !entry.value?.has(kid);

  return (await cachedLoad(entry, due, () => importKeys(jwksUri, fetchImpl))).get(kid);
}

/**
 * Verifies a Didit access token on your server: an ES256 signature by one of
 * the issuer's published keys, the access token type (`at+jwt`, so ID tokens
 * are refused), the issuer, the audience, expiry and not-before.
 * Resolves to the token's claims; rejects with a DiditAuthError otherwise.
 *
 * Tokens stay valid until they expire (five minutes). For actions that must
 * see a sign-out or a block instantly, also check the session with the API.
 */
export async function verifyToken(token: string, options: VerifyTokenOptions = {}): Promise<DiditTokenClaims> {
  const key = options.publishableKey ? parsePublishableKey(options.publishableKey) : null;
  const issuer = options.issuer ?? key?.apiBase;
  const audiences = ([] as unknown[]).concat(options.audience ?? key?.applicationId ?? []);
  const fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  const tolerance = options.clockTolerance ?? 5;

  if (!issuer || !audiences.length) {
    throw new DiditAuthError("invalid_request", "Pass publishableKey, or issuer and audience.");
  }
  const parts = typeof token === "string" ? token.split(".") : [];
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  let signature: ReturnType<typeof fromBase64Url>;

  try {
    if (parts.length !== 3) throw new Error();
    header = JSON.parse(decodeText(parts[0]));
    claims = JSON.parse(decodeText(parts[1]));
    signature = fromBase64Url(parts[2]);
  } catch {
    throw invalid("The token is not a JWT.");
  }
  // Only ES256 is accepted, so "none", HMAC and RSA tokens can never pass with a Didit key.
  if (header?.alg !== "ES256" || typeof header.kid !== "string" || header.crit !== undefined) {
    throw invalid("The token is not signed with ES256 by a known key.");
  }
  // The issuer signs ID tokens ("JWT") with the same keys, issuer and audience: only access tokens pass.
  if (!ACCESS_TOKEN_TYPES.includes(header.typ as string)) throw invalid("The token is not an access token.");
  if (signature.length !== 64 || !claims || typeof claims !== "object" || Array.isArray(claims)) {
    throw invalid("The token is malformed.");
  }
  const publicKey = await signingKey(options.jwksUri ?? (await jwksUriFor(issuer, fetchImpl)), header.kid, fetchImpl);
  if (!publicKey) throw invalid("The token was signed with an unknown key.");
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  if (!(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, signature, signed))) {
    throw invalid("The token signature is invalid.");
  }
  const now = Date.now() / 1000;

  if (claims.iss !== issuer) throw invalid("The token was issued for another application.");
  if (!([] as unknown[]).concat(claims.aud).some((audience) => audiences.includes(audience))) {
    throw invalid("The token is meant for another audience.");
  }
  if (typeof claims.sub !== "string" || !claims.sub || typeof claims.exp !== "number") {
    throw invalid("The token has no subject or expiry.");
  }
  if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > now + tolerance)) {
    throw invalid("The token is not valid yet.");
  }
  if (claims.exp <= now - tolerance) throw new DiditAuthError("token_expired", "The token has expired.", { status: 401 });
  return claims as DiditTokenClaims;
}
