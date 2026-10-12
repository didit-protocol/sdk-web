import { NextResponse, type NextRequest } from "next/server";

import type { DiditSession } from "@didit-protocol/auth-react/provider";

import { CLIENT_HEADER, PATH_HEADER } from "../constants.js";
import { resolveConfig, type DiditAuthConfig, type Env } from "./config.js";
import {
  cookieNames,
  cookieOptions,
  decodeTransaction,
  encodeRefresh,
  encodeTransaction,
  readSessionCookies,
  transactionCookie,
  type CookieNames
} from "./cookies.js";
import { callbackFailureCopy, negotiateLocale } from "./locale.js";
import { codeChallenge, randomString, timingSafeEqual } from "./pkce.js";
import { safeReturnTo } from "./return-to.js";
import {
  DiditAuthApiError,
  endSession,
  exchangeCode,
  fetchSession,
  listGrants,
  revokeGrant,
  type TokenSet
} from "./runtime-api.js";
import { cachedSession, forgetSession, primeSession, refreshOnce } from "./session-cache.js";

export type RouteMatcher = string | RegExp | ReadonlyArray<string | RegExp> | ((request: NextRequest) => boolean);

export interface DiditAuthProxyOptions {
  /** Paths that need a signed-in person. A string covers the path and everything below it. */
  protect?: RouteMatcher;
  /** Where signed-out visitors of a protected path go. Defaults to `/auth/sign-in`. */
  signInUrl?: string;
  /** Where people land after signing out. Defaults to `/`. */
  afterSignOutUrl?: string;
}

/** New tokens to store, or a session to forget. */
type CookieUpdate = { kind: "set"; tokens: TokenSet; sessionEnd: number } | { kind: "clear" } | null;

interface Resolved {
  access: string | null;
  session: DiditSession | null;
  update: CookieUpdate;
}

const GRANT_PATH = /^agents\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const HOSTED_START = new Set(["sign-in", "sign-up", "step-up"]);

function noStore<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function readCookies(request: NextRequest, names: CookieNames) {
  return readSessionCookies(names, (name) => request.cookies.get(name)?.value);
}

function writeUpdate(response: NextResponse, config: DiditAuthConfig, update: CookieUpdate): void {
  if (!update) return;
  const names = cookieNames(config);

  if (update.kind === "clear") {
    response.cookies.set(names.access, "", cookieOptions(config, 0));
    response.cookies.set(names.refresh, "", cookieOptions(config, 0));
    return;
  }
  const now = Date.now() / 1000;
  // Expire the access cookie a little early so the next request refreshes before Didit rejects it.
  const accessAge = Math.min(update.tokens.expiresIn - 5, update.sessionEnd - now);

  response.cookies.set(names.access, update.tokens.accessToken, cookieOptions(config, accessAge));
  response.cookies.set(
    names.refresh,
    encodeRefresh({ token: update.tokens.refreshToken, expiresAt: update.sessionEnd }),
    cookieOptions(config, update.sessionEnd - now)
  );
}

/** The request's `Cookie` header with the session cookies replaced, for the page that renders next. */
function rewriteCookieHeader(header: string | null, names: CookieNames, update: CookieUpdate): string {
  const kept = (header ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && ![names.access, names.refresh].includes(part.split("=")[0]));

  if (update?.kind === "set") {
    kept.push(`${names.access}=${update.tokens.accessToken}`);
    kept.push(`${names.refresh}=${encodeRefresh({ token: update.tokens.refreshToken, expiresAt: update.sessionEnd })}`);
  }
  return kept.join("; ");
}

/**
 * Finds the person behind the request's cookies, rotating the refresh token
 * when the access token has expired. With `validate`, the access token is
 * checked with Didit; without it, a present token is trusted for routing only.
 */
async function resolve(request: NextRequest, config: DiditAuthConfig, validate: boolean): Promise<Resolved> {
  const { access, refresh } = readCookies(request, cookieNames(config));
  const signedOut: Resolved = { access: null, session: null, update: null };

  if (access && !validate) return { access, session: null, update: null };
  if (access) {
    const session = await cachedSession(config, access);

    if (session || !refresh) return { access: session ? access : null, session, update: null };
  }
  if (!refresh) return signedOut;
  const tokens = await refreshOnce(config, refresh.token);

  if (!tokens) return { ...signedOut, update: { kind: "clear" } };
  const update: CookieUpdate = { kind: "set", tokens, sessionEnd: refresh.expiresAt };

  return {
    access: tokens.accessToken,
    session: validate ? await cachedSession(config, tokens.accessToken) : null,
    update
  };
}

function appOrigin(config: DiditAuthConfig): string {
  return new URL(config.redirectUri).origin;
}

/** A state-changing call must come from this app's own pages. */
function sameOrigin(request: NextRequest, config: DiditAuthConfig): boolean {
  const origin = request.headers.get("origin");

  if (origin) return origin === appOrigin(config);
  return request.headers.get("sec-fetch-site") === "same-origin";
}

function fromClient(request: NextRequest): boolean {
  return request.headers.get(CLIENT_HEADER) === "fetch" && request.headers.get("sec-fetch-site") !== "cross-site";
}

function json(body: unknown, status = 200): NextResponse {
  return noStore(NextResponse.json(body, { status }));
}

async function startHostedSignIn(request: NextRequest, config: DiditAuthConfig): Promise<NextResponse> {
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("redirect_url")) ?? "/";
  const stepUp = request.nextUrl.pathname === `${config.basePath}/step-up`;
  const current = stepUp ? await resolve(request, config, true) : null;

  if (stepUp && !current?.session) return json({ error: "signed_out" }, 401);
  const verifier = randomString();
  const state = randomString();
  // The hosted page opens on sign-in and links to sign-up and password reset itself.
  const hosted = new URL(`${config.frontendApi}/sign-in/`);

  hosted.searchParams.set("language", negotiateLocale(request.headers.get("accept-language")));
  hosted.searchParams.set("redirect_uri", config.redirectUri);
  hosted.searchParams.set("state", state);
  hosted.searchParams.set("code_challenge", await codeChallenge(verifier));
  hosted.searchParams.set("code_challenge_method", "S256");

  const response = noStore(NextResponse.redirect(hosted));

  response.cookies.set(
    transactionCookie(cookieNames(config), state),
    encodeTransaction({ verifier, state, returnTo, ...(current?.session ? { userId: current.session.user.id } : {}) }),
    cookieOptions(config, 600)
  );
  writeUpdate(response, config, current?.update ?? null);

  return response;
}

function callbackFailure(request: NextRequest, config: DiditAuthConfig, returnTo: string, reason: string): NextResponse {
  const locale = negotiateLocale(request.headers.get("accept-language"));
  const copy = callbackFailureCopy(locale);
  const again = `${config.basePath}/sign-in?redirect_url=${encodeURIComponent(returnTo)}`;
  const page = `<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${copy.title}</title><body style="font-family:system-ui,sans-serif;margin:48px auto;max-width:420px;padding:0 20px;line-height:1.5"><p>${copy.title}</p><p><a href="${again}">${copy.action}</a></p></body></html>`;

  console.warn(`[didit-auth] Sign-in callback refused: ${reason}.`);
  return noStore(new NextResponse(page, { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }));
}

async function completeSignIn(request: NextRequest, config: DiditAuthConfig): Promise<NextResponse> {
  const names = cookieNames(config);
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const transaction = state ? decodeTransaction(request.cookies.get(transactionCookie(names, state))?.value) : null;
  const returnTo = safeReturnTo(transaction?.returnTo) ?? "/";

  if (!code || !state || !transaction || !timingSafeEqual(transaction.state, state)) {
    return callbackFailure(request, config, returnTo, "state_mismatch");
  }
  let tokens: TokenSet;

  try {
    tokens = await exchangeCode(config, { code, verifier: transaction.verifier, userAgent: request.headers.get("user-agent") });
  } catch (error) {
    if (error instanceof DiditAuthApiError && error.status < 500 && error.status !== 429) {
      return callbackFailure(request, config, returnTo, error.code ?? `status_${error.status}`);
    }
    throw error;
  }
  const session = await fetchSession(config, tokens.accessToken);

  if (!session) return callbackFailure(request, config, returnTo, "session_unavailable");
  if (transaction.userId && transaction.userId !== session.user.id) {
    await endSession(config, tokens.accessToken);
    const rejected = callbackFailure(request, config, returnTo, "identity_mismatch");

    rejected.cookies.set(transactionCookie(names, state), "", cookieOptions(config, 0));
    return rejected;
  }
  primeSession(config, tokens.accessToken, session);

  // Signing in again in this browser (for example to confirm it is you) replaces the earlier session.
  const old = readCookies(request, names);
  const previous = old.access ?? (old.refresh ? (await refreshOnce(config, old.refresh.token))?.accessToken : null);

  if (previous && previous !== tokens.accessToken) {
    forgetSession(config, previous);
    await endSession(config, previous);
  }
  const response = noStore(NextResponse.redirect(new URL(returnTo, config.redirectUri), 303));

  writeUpdate(response, config, { kind: "set", tokens, sessionEnd: Math.floor(Date.parse(session.expiresAt) / 1000) });
  response.cookies.set(transactionCookie(names, state), "", cookieOptions(config, 0));
  return response;
}

async function signOut(request: NextRequest, config: DiditAuthConfig, options: DiditAuthProxyOptions): Promise<NextResponse> {
  if (!sameOrigin(request, config)) return json({ error: "forbidden" }, 403);
  const { access, refresh } = readCookies(request, cookieNames(config));
  let token = access;

  if (!token && refresh) token = (await refreshOnce(config, refresh.token))?.accessToken ?? null;
  if (token) {
    forgetSession(config, token);
    await endSession(config, token);
  }
  const target = safeReturnTo(request.nextUrl.searchParams.get("redirect_url")) ?? options.afterSignOutUrl ?? "/";
  const response = fromClient(request)
    ? noStore(new NextResponse(null, { status: 204 }))
    : noStore(NextResponse.redirect(new URL(target, config.redirectUri), 303));

  writeUpdate(response, config, { kind: "clear" });
  return response;
}

async function clientRoute(request: NextRequest, config: DiditAuthConfig, action: string): Promise<NextResponse | null> {
  const grant = action.match(GRANT_PATH)?.[1];
  const known = action === "session" || action === "token" || action === "agents" || Boolean(grant);

  if (!known) return null;
  if (!fromClient(request)) return json({ error: "forbidden" }, 403);
  const wanted = grant ? "DELETE" : "GET";

  if (request.method !== wanted) return json({ error: "method_not_allowed" }, 405);
  if (grant && !sameOrigin(request, config)) return json({ error: "forbidden" }, 403);

  const resolved = await resolve(request, config, true);
  let response: NextResponse;

  if (action === "session") response = json({ session: resolved.session });
  else if (!resolved.session || !resolved.access) response = json({ error: "signed_out" }, 401);
  else if (action === "token") response = json({ token: resolved.access });
  else if (grant) {
    try {
      await revokeGrant(config, resolved.access, grant);
      response = noStore(new NextResponse(null, { status: 204 }));
    } catch (error) {
      if (!(error instanceof DiditAuthApiError) || error.status !== 404) throw error;
      response = json({ error: "not_found" }, 404);
    }
  } else response = json({ agents: await listGrants(config, resolved.access) });

  writeUpdate(response, config, resolved.update);
  return response;
}

function matches(matcher: RouteMatcher | undefined, request: NextRequest): boolean {
  if (!matcher) return false;
  if (typeof matcher === "function") return matcher(request);
  const path = request.nextUrl.pathname;
  const list: ReadonlyArray<string | RegExp> = typeof matcher === "string" || matcher instanceof RegExp ? [matcher] : matcher;

  return list.some((entry) => {
    if (typeof entry !== "string") {
      entry.lastIndex = 0;
      return entry.test(path);
    }
    const prefix = entry.endsWith("/") ? entry : `${entry}/`;

    return path === entry || path.startsWith(prefix);
  });
}

async function page(request: NextRequest, config: DiditAuthConfig, options: DiditAuthProxyOptions): Promise<NextResponse> {
  const isProtected = matches(options.protect, request);
  const requested = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  let resolved: Resolved;

  try {
    resolved = await resolve(request, config, isProtected);
  } catch (error) {
    // Didit could not be reached: public pages still render, protected ones fail rather than open.
    if (isProtected) throw error;
    console.error("[didit-auth] Could not refresh the session.", error);
    resolved = { access: null, session: null, update: null };
  }

  if (isProtected && !resolved.session) {
    const signIn = new URL(options.signInUrl ?? `${config.basePath}/sign-in`, config.redirectUri);

    signIn.searchParams.set("redirect_url", requested);
    const response = noStore(NextResponse.redirect(signIn));

    writeUpdate(response, config, resolved.update);
    return response;
  }
  const headers = new Headers(request.headers);

  headers.set(PATH_HEADER, requested);
  if (resolved.update) headers.set("cookie", rewriteCookieHeader(request.headers.get("cookie"), cookieNames(config), resolved.update));
  const response = NextResponse.next({ request: { headers } });

  writeUpdate(response, config, resolved.update);
  return response;
}

/**
 * The Didit Authentication proxy. Export it from `proxy.ts` (Next.js 16) or
 * `middleware.ts` (Next.js 15). It serves the `/auth/*` routes, keeps the
 * session in httpOnly cookies, refreshes it, and guards the `protect` paths.
 */
export function diditAuthProxy(options: DiditAuthProxyOptions = {}, env?: Env) {
  let config: DiditAuthConfig | undefined;

  return async function proxy(request: NextRequest): Promise<NextResponse> {
    config ??= resolveConfig(env);
    const { pathname } = request.nextUrl;

    if (pathname === config.callbackPath) {
      return request.method === "GET" ? completeSignIn(request, config) : json({ error: "method_not_allowed" }, 405);
    }
    if (pathname.startsWith(`${config.basePath}/`)) {
      const action = pathname.slice(config.basePath.length + 1);

      if (HOSTED_START.has(action)) {
        return request.method === "GET" ? startHostedSignIn(request, config) : json({ error: "method_not_allowed" }, 405);
      }
      if (action === "sign-out") {
        return request.method === "POST" ? signOut(request, config, options) : json({ error: "method_not_allowed" }, 405);
      }
      const handled = await clientRoute(request, config, action);

      if (handled) return handled;
    }
    return page(request, config, options);
  };
}
