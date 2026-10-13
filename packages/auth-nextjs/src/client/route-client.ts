import type { DiditAuth as HeadlessCore, DiditSessionResponse, DiditSignInResult } from "@didit-protocol/auth";
import { createAuthStore, snapshotOf } from "@didit-protocol/auth-react/provider";
import type {
  AgentGrant,
  AuthClient,
  DiditSession,
  RedirectOptions,
  SignInResult,
  StepUpResult
} from "@didit-protocol/auth-react/provider";

import { safeReturnTo } from "../server/return-to.js";
import { toSession, type Json } from "../server/runtime-api.js";

import { BASE_PATH, CLIENT_HEADER } from "../constants.js";

const STEP_UP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RouteAuthClient extends AuthClient {
  /** Takes the session the server rendered with, for example after a navigation. */
  setSession(session: DiditSession | null): void;
}

export interface RouteClientOptions {
  /** The session the server rendered with; omit it to ask the proxy on load. */
  initialSession?: DiditSession | null;
  basePath?: string;
  /** How to leave the page for the hosted sign-in. Defaults to `window.location.assign`. */
  navigate?: (url: string) => void;
  /** The application's publishable key, for headless sign-in. */
  publishableKey?: string;
  /** This app's registered callback, for headless sign-in. */
  redirectUri?: string;
}

/**
 * The browser side of the Next.js integration. Tokens stay in httpOnly
 * cookies; the browser calls this app's own `/auth/*` routes, and Didit
 * directly only for the steps of a headless sign-in.
 */
export function createRouteClient({
  initialSession,
  basePath = BASE_PATH,
  navigate = (url) => window.location.assign(url),
  publishableKey,
  redirectUri
}: RouteClientOptions = {}): RouteAuthClient {
  const store = createAuthStore(initialSession === undefined ? { status: "loading", session: null } : snapshotOf(initialSession));
  let loaded = initialSession !== undefined;
  let headless: Promise<HeadlessCore> | null = null;
  let exchanged: DiditSession | null = null;

  const call = (path: string, init: RequestInit = {}) =>
    fetch(`${basePath}/${path}`, {
      ...init,
      credentials: "same-origin",
      headers: { Accept: "application/json", [CLIENT_HEADER]: "fetch", ...init.headers }
    });

  const post = (path: string, body: unknown) =>
    call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const here = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;

  const hereOr = (options?: RedirectOptions) => options?.redirectUrl ?? here();

  const go = (route: string, redirectUrl: string) => {
    navigate(`${basePath}/${route}?redirect_url=${encodeURIComponent(redirectUrl)}`);
    return Promise.resolve();
  };

  // The steps go from the browser straight to Didit, so its bot protection and rate limits see the
  // person rather than this app's server. Only the one-time code comes back here: the server
  // exchanges it, so the tokens stay in httpOnly cookies. Loaded on first use.
  function core(): Promise<HeadlessCore> {
    if (!publishableKey || !redirectUri) {
      return Promise.reject(new Error("[didit-auth] Headless sign-in needs the server <DiditAuth> in your root layout."));
    }
    headless ??= import("@didit-protocol/auth").then(({ createDiditAuth }) =>
      createDiditAuth({
        publishableKey,
        redirectUri,
        storage: "memory",
        async exchangeCode({ code, codeVerifier }) {
          const response = await post("exchange", { code, code_verifier: codeVerifier });

          if (!response.ok) throw new Error(`[didit-auth] Completing the sign-in failed with ${response.status}.`);
          const { session } = (await response.json()) as { session: DiditSessionResponse & Json };

          exchanged = toSession(session);
          store.set(snapshotOf(exchanged));
          return session;
        }
      })
    );
    return headless;
  }

  async function step(run: (auth: HeadlessCore) => Promise<DiditSignInResult>): Promise<SignInResult> {
    const result = await run(await core());

    if (result.status !== "signed_in") return result;
    // exchangeCode ran just before, and kept the session this app's server answered with.
    return { ...result, session: exchanged! };
  }

  return {
    getSnapshot: store.get,
    subscribe: store.subscribe,
    setSession(session) {
      const current = store.get().session;

      if (JSON.stringify(current) === JSON.stringify(session) && store.get().status !== "loading") return;
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
    reauthenticate: (options) => go("reauthenticate", hereOr(options)),
    async stepUp({ action, amount, currency }) {
      // The identity check returns to the callback, and the proxy brings the person back to this page.
      const response = await post("step-up", { action, amount, currency, redirect_url: here() });

      if (!response.ok) throw new Error(`[didit-auth] Asking for a step-up failed with ${response.status}.`);
      const { stepUp, verificationUrl } = (await response.json()) as { stepUp: StepUpResult; verificationUrl?: string };

      if (verificationUrl) navigate(verificationUrl);
      return stepUp;
    },
    async handleStepUpCallback(url) {
      const address = new URL(url ?? window.location.href, window.location.href);
      const id = address.searchParams.get("step_up");

      if (!id || !STEP_UP_ID.test(id)) throw new Error("[didit-auth] This address is not a step-up's return.");
      if (address.href === window.location.href) {
        address.searchParams.delete("step_up");
        window.history.replaceState(window.history.state, "", address.href);
      }
      // The address only says the person came back: Didit's record of the check is the outcome.
      const response = await call(`step-up/${id}`);

      if (!response.ok) throw new Error(`[didit-auth] Reading the step-up failed with ${response.status}.`);
      return ((await response.json()) as { stepUp: StepUpResult }).stepUp;
    },
    password: {
      signIn: (input) => step((auth) => auth.password.signIn(input))
    },
    emailCode: {
      start: (input) => step((auth) => auth.emailCode.start(input)),
      verify: (input) => step((auth) => auth.emailCode.verify(input))
    },
    phone: {
      start: (input) => step((auth) => auth.phone.start(input)),
      verify: (input) => step((auth) => auth.phone.verify(input))
    },
    protection: {
      verify: (input) => step((auth) => auth.protection.verify(input)),
      passkey: () => step((auth) => auth.protection.passkey())
    },
    mfa: {
      verify: (input) => step((auth) => auth.mfa.verify(input)),
      setup: (input) => step((auth) => auth.mfa.setup(input))
    },
    async signOut(options) {
      const response = await call("sign-out", { method: "POST" });

      if (!response.ok) throw new Error("[didit-auth] Could not sign out. Please retry.");
      store.set(snapshotOf(null));
      navigate(safeReturnTo(options?.redirectUrl) ?? "/");
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
