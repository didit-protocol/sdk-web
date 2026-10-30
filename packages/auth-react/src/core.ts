import {
  createDiditAuth,
  type DiditSession as CoreSession,
  type DiditSignInResult as CoreSignInResult
} from "@didit-protocol/auth";

import { safeReturnTo } from "./return-to.js";
import { createAuthStore, snapshotOf } from "./store.js";
import type { AuthClient, DiditSession, SignInResult } from "./types.js";

export interface CoreClientOptions {
  publishableKey: string;
  redirectUri?: string;
  language?: "en" | "es" | "fr" | "de" | "ja";
}

// Every client mounted on this page shares the browser's one session. When one of them restores,
// signs in or signs out, it tells the others to re-read the session, so two provider scopes on the
// same page never disagree about who is signed in. A client adds its listener once mounted.
const pagePeers = new Set<() => void>();

function announceSessionChange(source: () => void): void {
  pagePeers.forEach((refresh) => {
    if (refresh !== source) refresh();
  });
}

function toSession(session: CoreSession): DiditSession;
function toSession(session: CoreSession | null): DiditSession | null;
function toSession(session: CoreSession | null): DiditSession | null {
  if (!session) return null;

  return {
    id: session.sessionId,
    user: {
      id: session.userId, email: session.email, emailVerified: session.emailVerified,
      phone: session.phone, vendorData: session.vendorData,
      verifiedIdentity: session.verifiedIdentity, organizations: session.organizations
    },
    methods: session.methods, mfaVerified: session.mfaVerified, expiresAt: session.expiresAt
  };
}

function toResult(result: CoreSignInResult): SignInResult {
  return result.status === "signed_in" ? { ...result, session: toSession(result.session) } : result;
}

/** Adapts the browser peer to the components without accessing browser storage during SSR. */
export function createCoreAuthClient(options: CoreClientOptions): AuthClient {
  const store = createAuthStore({ status: "loading", session: null });
  let core: ReturnType<typeof createDiditAuth> | undefined;
  let loading: Promise<void> | null = null;
  let subscribers = 0;

  // Re-reads the shared browser session, so this client follows a sign-in or sign-out another
  // client on the same page just made (a second provider scope, or one that armed after it).
  function refreshFromPage(): void {
    if (!core) return;
    core.getSession().then(
      (session) => store.set(snapshotOf(toSession(session))),
      () => undefined
    );
  }

  function getCore() {
    if (core) return core;
    core = createDiditAuth(options);
    core.onAuthStateChange((_event, session) => {
      store.set(snapshotOf(toSession(session)));
      announceSessionChange(refreshFromPage);
    });

    return core;
  }

  async function restore() {
    const client = getCore();
    const query = new URLSearchParams(window.location.search);
    const callback = query.has("state") && (query.has("code") || query.has("error"))
      ? await client.handleRedirectCallback() : null;
    const target = safeReturnTo(callback?.returnTo);
    const next = snapshotOf(toSession(callback?.session ?? await client.getSession()));

    // A peer may have established the session while this client was behind; never undo it with a
    // stale "no session" read.
    if (next.status === "signed-in" || store.get().status !== "signed-in") store.set(next);
    announceSessionChange(refreshFromPage);
    if (target) window.history.replaceState(window.history.state, "", target);
  }

  return {
    getSnapshot: store.get,
    subscribe(listener) {
      const unsubscribe = store.subscribe(listener);
      if (subscribers++ === 0) pagePeers.add(refreshFromPage);

      return () => {
        unsubscribe();
        if (--subscribers === 0) pagePeers.delete(refreshFromPage);
      };
    },
    load() {
      loading ??= restore().catch(() => {
        // A peer may have established the session while this restore was failing: keep it.
        if (store.get().status !== "signed-in") store.set(snapshotOf(null));
        console.error("[didit-auth] Could not restore the session.");
      });

      return loading;
    },
    signIn: (redirect) => getCore().signIn({ returnTo: safeReturnTo(redirect?.redirectUrl) ?? undefined }),
    // The hosted contract currently opens the chooser; it offers account creation there.
    signUp: (redirect) => getCore().signIn({ returnTo: safeReturnTo(redirect?.redirectUrl) ?? undefined }),
    async signOut(redirect) {
      const target = safeReturnTo(redirect?.redirectUrl);

      await getCore().signOut();
      if (target) window.location.assign(target);
    },
    // Didit brings the person back to the client's redirect address (by default this page).
    stepUp: ({ action, amount, currency }) => getCore().stepUp({ action, amount, currency }),
    handleStepUpCallback: (url) => getCore().handleStepUpCallback(url),
    async reauthenticate(redirect) {
      await getCore().reauthenticate({ returnTo: safeReturnTo(redirect?.redirectUrl) ?? undefined });
    },
    // A headless sign-in reports SIGNED_IN through onAuthStateChange, which updates the store.
    password: {
      signIn: async (input) => toResult(await getCore().password.signIn(input))
    },
    emailCode: {
      start: async (input) => toResult(await getCore().emailCode.start(input)),
      verify: async (input) => toResult(await getCore().emailCode.verify(input))
    },
    phone: {
      start: async (input) => toResult(await getCore().phone.start(input)),
      verify: async (input) => toResult(await getCore().phone.verify(input))
    },
    protection: {
      verify: async (input) => toResult(await getCore().protection.verify(input)),
      passkey: async () => toResult(await getCore().protection.passkey())
    },
    mfa: {
      verify: async (input) => toResult(await getCore().mfa.verify(input)),
      setup: async (input) => toResult(await getCore().mfa.setup(input))
    },
    getToken: () => getCore().getToken(),
    listAgents: () => getCore().agents.list(),
    revokeAgent: (id) => getCore().agents.revoke(id)
  };
}
