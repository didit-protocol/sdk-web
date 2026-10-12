import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import type { DiditSession } from "@didit-protocol/auth-react/provider";

import { PATH_HEADER } from "../constants.js";
import { resolveConfig, type DiditAuthConfig } from "./config.js";
import { cookieNames, readSessionCookies } from "./cookies.js";
import { safeReturnTo } from "./return-to.js";
import { cachedSession } from "./session-cache.js";

export interface AuthState {
  session: DiditSession | null;
  userId: string | null;
  sessionId: string | null;
  /** The person's access token, for calling your own API from the server. */
  getToken(): Promise<string | null>;
}

export interface ProtectOptions {
  /** Where to send signed-out visitors. Defaults to `/auth/sign-in`. */
  signInUrl?: string;
}

let config: DiditAuthConfig | undefined;

function settings(): DiditAuthConfig {
  config ??= resolveConfig();
  return config;
}

const readAuth = cache(async (): Promise<AuthState> => {
  // Reading cookies first marks the route dynamic before any configuration is needed.
  const store = await cookies();
  const current = settings();
  const { access } = readSessionCookies(cookieNames(current), (name) => store.get(name)?.value);
  const session = access ? await cachedSession(current, access) : null;

  return {
    session,
    userId: session?.user.id ?? null,
    sessionId: session?.id ?? null,
    getToken: async () => (session ? access : null)
  };
});

/**
 * The signed-in person for this request, checked with Didit. Use it in server
 * components, route handlers and server actions. The proxy must run on the
 * route so an expired access token is refreshed first.
 */
export function auth(): Promise<AuthState> {
  return readAuth();
}

/** The session, or a redirect to sign in that returns to the requested page. */
auth.protect = async function protect(options: ProtectOptions = {}): Promise<DiditSession> {
  const { session } = await readAuth();

  if (session) return session;
  const target = new URL(options.signInUrl ?? `${settings().basePath}/sign-in`, "https://app.invalid");
  const requested = safeReturnTo((await headers()).get(PATH_HEADER));

  if (requested) target.searchParams.set("redirect_url", requested);
  redirect(`${target.pathname}${target.search}`);
};
