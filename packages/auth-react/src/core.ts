import { createDiditAuth } from "@didit-protocol/auth";

import { createAuthStore, snapshotOf } from "./store.js";
import type { AuthClient } from "./types.js";

export interface CoreClientOptions {
  publishableKey: string;
  frontendApi?: string;
  redirectUri?: string;
}

/** Adapts the browser client of `@didit-protocol/auth` to the components' AuthClient. */
export function createCoreAuthClient(options: CoreClientOptions): AuthClient {
  const core = createDiditAuth(options);
  const store = createAuthStore({ status: "loading", session: null });
  let loading: Promise<void> | null = null;

  core.onAuthStateChange((session) => store.set(snapshotOf(session)));

  return {
    getSnapshot: store.get,
    subscribe: store.subscribe,
    load() {
      loading ??= (async () => {
        try {
          const callback = await core.handleRedirectCallback();
          store.set(snapshotOf(await core.getSession()));
          if (callback?.returnTo) window.history.replaceState(window.history.state, "", callback.returnTo);
        } catch (error) {
          store.set(snapshotOf(null));
          console.error("[didit-auth] Could not restore the session.", error);
        }
      })();
      return loading;
    },
    signIn: (redirect) => core.signIn({ returnTo: redirect?.redirectUrl, screen: "sign-in" }),
    signUp: (redirect) => core.signIn({ returnTo: redirect?.redirectUrl, screen: "sign-up" }),
    async signOut(redirect) {
      await core.signOut();
      if (redirect?.redirectUrl) window.location.assign(redirect.redirectUrl);
    },
    stepUp: (redirect) => core.stepUp({ returnTo: redirect?.redirectUrl }),
    getToken: () => core.getToken(),
    listAgents: () => core.agents.list(),
    revokeAgent: (id) => core.agents.revoke(id)
  };
}
