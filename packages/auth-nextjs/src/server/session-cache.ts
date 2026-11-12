import type { DiditSession } from "@didit-protocol/auth-react/provider";

import type { DiditAuthConfig } from "./config.js";
import { fetchSession, refreshTokens, type TokenSet } from "./runtime-api.js";

const MAX_ENTRIES = 1000;
/**
 * Requests that left the browser with the previous refresh token (parallel
 * prefetches, a second tab) get the tokens the first refresh produced instead
 * of spending the old token again: the Frontend API treats a reused refresh
 * token as theft and ends the session.
 */
const REFRESH_GRACE_MS = 10_000;

interface Expiring<T> {
  value: T;
  until: number;
}

const sessions = new Map<string, Expiring<DiditSession>>();
const sessionLookups = new Map<string, Promise<DiditSession | null>>();
const refreshes = new Map<string, Promise<TokenSet | null>>();
const refreshed = new Map<string, Expiring<TokenSet>>();

function remember<T>(map: Map<string, Expiring<T>>, key: string, value: T, ms: number): void {
  const now = Date.now();

  map.forEach((entry, entryKey) => {
    if (entry.until <= now) map.delete(entryKey);
  });
  while (map.size >= MAX_ENTRIES) map.delete(map.keys().next().value as string);
  map.set(key, { value, until: now + ms });
}

function fresh<T>(map: Map<string, Expiring<T>>, key: string): T | null {
  const entry = map.get(key);

  return entry && entry.until > Date.now() ? entry.value : null;
}

/** The session behind an access token, reused for a few seconds so a page render costs one call at most. */
export function cachedSession(config: DiditAuthConfig, accessToken: string): Promise<DiditSession | null> {
  const key = `${config.frontendApi}\n${accessToken}`;
  const hit = config.sessionCacheMs > 0 ? fresh(sessions, key) : null;

  if (hit) return Promise.resolve(hit);
  let lookup = sessionLookups.get(key);

  if (!lookup) {
    lookup = fetchSession(config, accessToken)
      .then((session) => {
        if (session && config.sessionCacheMs > 0) remember(sessions, `${config.frontendApi}\n${accessToken}`, session, Math.min(config.sessionCacheMs, Date.parse(session.expiresAt) - Date.now()));
        else sessions.delete(key);
        return session;
      })
      .finally(() => sessionLookups.delete(key));
    sessionLookups.set(key, lookup);
  }
  return lookup;
}

/** Seeds the cache with a session that was just validated (after a sign-in). */
export function primeSession(config: DiditAuthConfig, accessToken: string, session: DiditSession): void {
  if (config.sessionCacheMs > 0) remember(sessions, `${config.frontendApi}\n${accessToken}`, session, Math.min(config.sessionCacheMs, Date.parse(session.expiresAt) - Date.now()));
}

export function forgetSession(config: DiditAuthConfig, accessToken: string): void {
  sessions.delete(`${config.frontendApi}\n${accessToken}`);
}

/**
 * Rotates a refresh token once, however many requests ask at the same time.
 * Resolves `null` when the grant is spent or the session is over.
 */
export function refreshOnce(config: DiditAuthConfig, refreshToken: string): Promise<TokenSet | null> {
  const key = `${config.frontendApi}\n${refreshToken}`;
  const recent = fresh(refreshed, key);

  if (recent) return Promise.resolve(recent);
  let pending = refreshes.get(key);

  if (!pending) {
    pending = refreshTokens(config, refreshToken)
      .then(
        (tokens) => {
          remember(refreshed, key, tokens, REFRESH_GRACE_MS);
          return tokens;
        },
        (error: unknown) => {
          if (error && typeof error === "object" && "invalidGrant" in error && error.invalidGrant) return null;
          throw error;
        }
      )
      .finally(() => refreshes.delete(key));
    refreshes.set(key, pending);
  }
  return pending;
}

/** Test hook: forget everything this process remembers. */
export function resetCaches(): void {
  sessions.clear();
  sessionLookups.clear();
  refreshes.clear();
  refreshed.clear();
}
