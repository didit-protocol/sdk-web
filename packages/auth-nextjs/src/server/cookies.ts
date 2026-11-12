import type { DiditAuthConfig } from "./config.js";

export interface CookieNames {
  access: string;
  refresh: string;
  /** Prefix of the per-sign-in transaction cookie; the state's first characters follow. */
  transaction: string;
  /** The page to come back to after a step-up's identity check. */
  stepUp: string;
}

/** `__Host-` names cannot be set by a subdomain or for another path, so they need HTTPS. */
export function cookieNames(config: Pick<DiditAuthConfig, "secure">): CookieNames {
  const prefix = config.secure ? "__Host-" : "";

  return { access: `${prefix}didit_at`, refresh: `${prefix}didit_rt`, transaction: `${prefix}didit_tx.`, stepUp: `${prefix}didit_su` };
}

export interface CookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
}

export function cookieOptions(config: Pick<DiditAuthConfig, "secure">, maxAge: number): CookieOptions {
  return { httpOnly: true, secure: config.secure, sameSite: "lax", path: "/", maxAge: Math.max(0, Math.floor(maxAge)) };
}

export interface StoredRefresh {
  token: string;
  /** Unix seconds when the session ends. */
  expiresAt: number;
}

/** The refresh cookie keeps the session's end next to the token: `<unix seconds>.<token>`. */
export function encodeRefresh(value: StoredRefresh): string {
  return `${value.expiresAt}.${value.token}`;
}

export function decodeRefresh(raw: string | undefined): StoredRefresh | null {
  const match = raw?.match(/^(\d{1,12})\.([A-Za-z0-9_-]{1,128})$/);

  return match ? { expiresAt: Number(match[1]), token: match[2] } : null;
}

export interface Transaction {
  /** PKCE verifier. */
  verifier: string;
  state: string;
  /** Path to return to after signing in. */
  returnTo: string;
  /** Identity that must complete a step-up. */
  userId?: string;
}

export function transactionCookie(names: CookieNames, state: string): string {
  return `${names.transaction}${state.slice(0, 16)}`;
}

// Verifier and state are base64url and encodeURIComponent always escapes ":".
export function encodeTransaction(value: Transaction): string {
  return [value.verifier, value.state, encodeURIComponent(value.returnTo), ...(value.userId ? [encodeURIComponent(value.userId)] : [])].join(":");
}

export function decodeTransaction(raw: string | undefined): Transaction | null {
  const parts = raw?.split(":");

  if (!parts || (parts.length !== 3 && parts.length !== 4)) return null;
  try {
    return { verifier: parts[0], state: parts[1], returnTo: decodeURIComponent(parts[2]), ...(parts[3] ? { userId: decodeURIComponent(parts[3]) } : {}) };
  } catch {
    return null;
  }
}

export interface SessionCookies {
  access: string | null;
  refresh: StoredRefresh | null;
}

export function readSessionCookies(names: CookieNames, get: (name: string) => string | undefined): SessionCookies {
  const access = get(names.access);

  return { access: access && access.length <= 3800 && /^[A-Za-z0-9_.-]+$/.test(access) ? access : null, refresh: decodeRefresh(get(names.refresh)) };
}
