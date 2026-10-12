import { createAuthStore, snapshotOf } from "@didit-protocol/auth-react/provider";
import type { AgentGrant, AuthClient, DiditSession, RedirectOptions } from "@didit-protocol/auth-react/provider";

import { BASE_PATH, CLIENT_HEADER } from "../constants.js";

export interface RouteAuthClient extends AuthClient {
  /** Takes the session the server rendered with, for example after a navigation. */
  setSession(session: DiditSession | null): void;
}

export interface RouteClientOptions {
  /** The session the server rendered with; omit it to ask the proxy on load. */
  initialSession?: DiditSession | null;
  basePath?: string;
}

/**
 * The browser side of the Next.js integration. Tokens stay in httpOnly
 * cookies; the browser only calls this app's own `/auth/*` routes.
 */
export function createRouteClient({ initialSession, basePath = BASE_PATH }: RouteClientOptions = {}): RouteAuthClient {
  const store = createAuthStore(initialSession === undefined ? { status: "loading", session: null } : snapshotOf(initialSession));
  let loaded = initialSession !== undefined;

  const call = (path: string, init: RequestInit = {}) =>
    fetch(`${basePath}/${path}`, {
      ...init,
      credentials: "same-origin",
      headers: { Accept: "application/json", [CLIENT_HEADER]: "fetch", ...init.headers }
    });

  const hereOr = (options?: RedirectOptions) =>
    options?.redirectUrl ?? `${window.location.pathname}${window.location.search}${window.location.hash}`;

  const go = (route: string, redirectUrl: string) => {
    window.location.assign(`${basePath}/${route}?redirect_url=${encodeURIComponent(redirectUrl)}`);
    return Promise.resolve();
  };

  return {
    getSnapshot: store.get,
    subscribe: store.subscribe,
    setSession(session) {
      const current = store.get().session;

      if (current?.id === session?.id && current?.expiresAt === session?.expiresAt && store.get().status !== "loading") return;
      store.set(snapshotOf(session));
    },
    async load() {
      if (loaded) return;
      loaded = true;
      try {
        const response = await call("session");
        const body = response.ok ? ((await response.json()) as { session: DiditSession | null }) : { session: null };

        store.set(snapshotOf(body.session));
      } catch {
        store.set(snapshotOf(null));
      }
    },
    signIn: (options) => go("sign-in", hereOr(options)),
    signUp: (options) => go("sign-up", hereOr(options)),
    stepUp: (options) => go("step-up", hereOr(options)),
    async signOut(options) {
      await call("sign-out", { method: "POST" }).catch(() => undefined);
      store.set(snapshotOf(null));
      window.location.assign(options?.redirectUrl ?? "/");
    },
    async getToken() {
      const response = await call("token");

      if (!response.ok) return null;
      return ((await response.json()) as { token: string | null }).token;
    },
    async listAgents() {
      const response = await call("agents");

      if (!response.ok) throw new Error(`[didit-auth] Listing agents failed with ${response.status}.`);
      return ((await response.json()) as { agents: AgentGrant[] }).agents;
    },
    async revokeAgent(id) {
      const response = await call(`agents/${encodeURIComponent(id)}`, { method: "DELETE" });

      if (!response.ok) throw new Error(`[didit-auth] Revoking the agent failed with ${response.status}.`);
    }
  };
}
