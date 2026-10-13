import { deviceHeaders, deviceSignalsEnabled } from "./device";
import { codeChallenge, decodeText, randomString } from "./encoding";
import { DiditAuthError } from "./errors";
import { createHttpClient, type RequestOptions } from "./http";
import { parsePublishableKey } from "./key";
import {
  committedValue,
  memoryStorage,
  resolveStorage,
  webStorage,
  type CommittedValue,
  type DiditAuthStorage,
  type SyncStorage
} from "./storage";
import type {
  DiditAgentGrant,
  DiditAuth,
  DiditAuthEvent,
  DiditAuthLanguage,
  DiditAuthListener,
  DiditAuthOptions,
  DiditSession,
  DiditSignInResult,
  SignInRedirectOptions,
  StepUpOptions
} from "./types";
import {
  assertPasskeysAvailable,
  creationOptions,
  credentialJSON,
  requestOptions,
  runCeremony,
  type PasskeyOptionsJSON
} from "./webauthn";

const LANGUAGES = ["en", "es", "fr", "de", "ja"];
// Refresh this long before the five-minute access token expires.
const EXPIRY_MARGIN_MS = 30_000;
// The runtime API allows 30 requests a minute per IP and endpoint.
const SESSION_CACHE_MS = 30_000;
// Magic links stay valid for fifteen minutes after they are sent.
const REDIRECT_TTL_MS = 20 * 60_000;
const GRANTS_PAGE = 100;

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  sessionId: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  session_id: string;
}

interface SessionResponse {
  sub: string;
  sid: string;
  application_id: string;
  amr?: string[];
  mfa_verified?: boolean;
  email?: string | null;
  email_verified?: boolean;
  phone?: string | null;
  verified_identity?: Record<string, unknown> | null;
  expires_at: string;
  organizations?: { organization_id: string; organization__name: string; role: string }[];
  vendor_data?: string | null;
}

/** What a primary proof, MFA step or agent consent answers. */
interface ProofResponse {
  code?: string;
  state?: string;
  redirect_uri?: string;
  challenge?: string;
  uri?: string;
  mfa_required?: boolean;
  mfa_enrollment_required?: boolean;
  recovery_codes?: string[];
}

interface ChallengeResponse {
  challenge: string;
  expires_in: number;
}

interface PasskeyResponse {
  challenge: string;
  options: PasskeyOptionsJSON;
}

interface GrantResponse {
  id: string;
  agent_id: string;
  agent__name: string;
  scopes: string[];
  expires_at: string;
  revoked_at: string | null;
}

/** A headless sign-in in progress: its PKCE-bound transaction and the step it waits for. */
interface Attempt {
  transaction: string;
  verifier: string;
  state: string;
  redirectUri: string;
  stepUpUser?: string;
  step?: "email" | "phone" | "mfa" | "mfa_setup";
  challenge?: string;
  purpose?: "login" | "signup";
  invitation?: string;
}

/** A hosted sign-in waiting for its redirect, stored under its state. */
interface PendingRedirect {
  verifier: string;
  redirectUri: string;
  returnTo: string | null;
  stepUpUser: string | null;
  createdAt: number;
}

function parseTokens(raw: string | null): Tokens | null {
  try {
    const tokens = raw ? JSON.parse(raw) : null;
    return tokens && typeof tokens.accessToken === "string" && typeof tokens.refreshToken === "string" ? tokens : null;
  } catch {
    return null;
  }
}

function fromResponse(response: TokenResponse): Tokens {
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: Date.now() + response.expires_in * 1000,
    sessionId: response.session_id
  };
}

/** Reads a claim from a JWT access token without verifying it (display only; servers use verifyToken). */
function unverifiedClaim(token: string, name: string): unknown {
  const parts = token.split(".");
  try {
    return parts.length === 3 ? JSON.parse(decodeText(parts[1]))[name] : undefined;
  } catch {
    return undefined;
  }
}

function toSession(body: SessionResponse, accessToken: string): DiditSession {
  const vendorData = body.vendor_data ?? unverifiedClaim(accessToken, "vendor_data");

  return {
    userId: String(body.sub),
    sessionId: String(body.sid),
    applicationId: String(body.application_id),
    vendorData: typeof vendorData === "string" && vendorData ? vendorData : null,
    email: body.email || null,
    emailVerified: !!body.email_verified,
    phone: body.phone || null,
    methods: body.amr ?? [],
    mfaVerified: !!body.mfa_verified,
    verifiedIdentity: body.verified_identity ?? null,
    organizations: (body.organizations ?? []).map((organization) => ({
      id: String(organization.organization_id),
      name: organization.organization__name,
      role: organization.role
    })),
    expiresAt: body.expires_at
  };
}

function withCode(redirectUri: string, code: string, state: string): string {
  const url = new URL(redirectUri);
  url.searchParams.append("code", code);
  url.searchParams.append("state", state);
  return url.href;
}

/**
 * Creates the Didit Authentication client for one application.
 *
 * ```ts
 * const auth = createDiditAuth({ publishableKey: "pk_live_..." });
 * await auth.signIn(); // hosted page
 * // on the redirect page
 * const { session } = await auth.handleRedirectCallback();
 * ```
 */
export function createDiditAuth(options: DiditAuthOptions): DiditAuth {
  const key = parsePublishableKey(options.publishableKey);
  const storageKey = `didit-auth:${key.applicationId}`;
  // Each hosted sign-in waits under its own key: written once by the tab that starts it, removed by the
  // one that completes it. No tab rewrites another's entry, so sign-ins started or completed in several
  // tabs at the same moment cannot drop each other or bring back one already used.
  const pendingPrefix = `${storageKey}:pending:`;
  const signals = options.deviceSignals ?? "auto";
  const request = createHttpClient(key.apiBase, options.fetch ?? ((input, init) => fetch(input, init)), () =>
    deviceSignalsEnabled(signals, key.apiBase) ? deviceHeaders() : Promise.resolve({})
  );
  const listeners = new Set<DiditAuthListener>();
  let tokenStore: DiditAuthStorage | null = null;
  let pendingStore: SyncStorage | null = null;
  let lockedStore: CommittedValue | null | undefined;
  let cached: { session: DiditSession; sessionId: string; at: number } | null = null;
  let sessionRequest: Promise<DiditSession | null> | null = null;
  let refreshing: Promise<Tokens | null> | null = null;
  let attempt: Attempt | null = null;
  let enrollment: string | null = null;
  let stopSync: (() => void) | null = null;
  // The stored tokens as this tab last wrote or reported them (undefined until then).
  let observed: string | null | undefined;

  // Resolved on first use, so creating the client during server rendering touches no browser API.
  const storage = () => (tokenStore ??= resolveStorage(options.storage));
  // Hosted sign-ins outlive the page and, for magic links, the tab: keep them in localStorage when possible.
  const pendingStorage = () => (pendingStore ??= webStorage("local") ?? webStorage("session") ?? memoryStorage());

  function language(value?: string): DiditAuthLanguage | undefined {
    const tag = (value ?? options.language ?? (typeof navigator === "undefined" ? "" : navigator.language) ?? "")
      .slice(0, 2)
      .toLowerCase();
    return LANGUAGES.includes(tag) ? (tag as DiditAuthLanguage) : undefined;
  }

  function defaultRedirectUri(): string {
    if (options.redirectUri) return options.redirectUri;
    if (typeof location === "undefined") {
      throw new DiditAuthError("invalid_redirect_uri", "Set redirectUri when running outside a browser.");
    }
    return location.origin + location.pathname;
  }

  function emit(event: DiditAuthEvent, session: DiditSession | null): void {
    listeners.forEach((listener) => {
      try {
        listener(event, session);
      } catch {
        // A failing listener never breaks the auth flow or the other listeners.
      }
    });
  }

  const readTokens = async () => parseTokens(await storage().getItem(storageKey));

  // localStorage can show a tab another tab's write a moment after that tab released the token lock
  // (WebKit does), and acting on the older tokens would present a used refresh token, which revokes the
  // session, or end a replaced session with a rotated access token. So each holder of the lock also
  // commits the tokens to IndexedDB, and the next holder reads them from there.
  function committed(): CommittedValue | null {
    if (lockedStore === undefined) lockedStore = sharedAcrossTabs() ? committedValue(storageKey) : null;
    return lockedStore;
  }

  // The stored tokens as the last holder of the token lock left them. Call only while holding it.
  async function lockedTokens(): Promise<Tokens | null> {
    const raw = await committed()?.read();
    return raw === undefined ? readTokens() : parseTokens(raw);
  }

  // Call only while holding the token lock.
  async function writeTokens(tokens: Tokens | null): Promise<void> {
    observed = tokens ? JSON.stringify(tokens) : null;
    if (observed) await storage().setItem(storageKey, observed);
    else await storage().removeItem(storageKey);
    await committed()?.write(observed);
  }

  async function signedOut(had: Tokens | null): Promise<void> {
    await writeTokens(null);
    cached = null;
    attempt = null;
    enrollment = null;
    if (had) emit("SIGNED_OUT", null);
  }

  // Every change of the stored tokens holds one lock across this origin's tabs (Web Locks API), so a
  // refresh finishing in one tab cannot overwrite a sign-in or undo a sign-out made in another. The API
  // resolves with the callback's settled value, which its DOM typing models as a nested promise.
  function withTokenLock<T>(task: () => Promise<T>): Promise<T> {
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
    return locks ? (locks.request(`${storageKey}:tokens`, task) as unknown as Promise<T>) : task();
  }

  function refresh(stale: Tokens): Promise<Tokens | null> {
    const run = async (): Promise<Tokens | null> => {
      // Another tab may have rotated the tokens while this one waited for the lock. Presenting
      // an already used refresh token revokes the whole session, so use theirs instead.
      const latest = await lockedTokens();
      if (!latest || latest.refreshToken !== stale.refreshToken) return latest;
      try {
        const next = fromResponse(
          await request<TokenResponse>("token/", {
            body: { grant_type: "refresh_token", refresh_token: latest.refreshToken }
          })
        );
        await writeTokens(next);
        emit("TOKEN_REFRESHED", cached?.session ?? null);
        return next;
      } catch (error) {
        if (!(error instanceof DiditAuthError) || error.code !== "invalid_grant") throw error;
        await signedOut(latest);
        return null;
      }
    };

    if (!refreshing) {
      refreshing = withTokenLock(run).finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  async function currentTokens(): Promise<Tokens | null> {
    const tokens = await readTokens();
    return !tokens || tokens.expiresAt - EXPIRY_MARGIN_MS > Date.now() ? tokens : refresh(tokens);
  }

  // A request as the signed-in person. When the access token was rotated by another tab
  // or revoked meanwhile, the API rejects it before acting, so refreshing once and retrying is safe.
  async function authed<T>(path: string, init: RequestOptions = {}): Promise<T> {
    let tokens = await currentTokens();
    for (let retried = false; ; retried = true) {
      if (!tokens) throw new DiditAuthError("not_signed_in", "Sign in first.");
      try {
        return await request<T>(path, { ...init, token: tokens.accessToken });
      } catch (error) {
        if (retried || !(error instanceof DiditAuthError) || error.code !== "invalid_token") throw error;
        tokens = await refresh(tokens);
      }
    }
  }

  // Ends a session this browser no longer uses. The API ends a session only for one of its
  // live access tokens, so an expired one is renewed with the session's refresh token first.
  async function endSession(tokens: Tokens): Promise<void> {
    let { accessToken } = tokens;
    if (tokens.expiresAt - EXPIRY_MARGIN_MS <= Date.now()) {
      accessToken = (
        await request<TokenResponse>("token/", {
          body: { grant_type: "refresh_token", refresh_token: tokens.refreshToken }
        })
      ).access_token;
    }
    await request("session/", { method: "DELETE", token: accessToken });
  }

  async function exchange(
    code: string,
    verifier: string,
    redirectUri: string,
    stepUpUser?: string | null
  ): Promise<DiditSession> {
    const tokens = fromResponse(
      await request<TokenResponse>("token/", {
        body: { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri }
      })
    );
    const session = toSession(await request<SessionResponse>("session/", { token: tokens.accessToken }), tokens.accessToken);

    if (stepUpUser && session.userId !== stepUpUser) {
      await request("session/", { method: "DELETE", token: tokens.accessToken }).catch(() => undefined);
      throw new DiditAuthError("step_up_user_mismatch", "A different person completed the sign-in.");
    }
    const previous = await withTokenLock(async () => {
      const previous = await lockedTokens();
      await writeTokens(tokens);
      return previous;
    });
    cached = { session, sessionId: tokens.sessionId, at: Date.now() };
    attempt = null;
    if (previous && previous.sessionId !== tokens.sessionId) {
      // This browser can no longer use the replaced session: end it at Didit too.
      await endSession(previous).catch(() => undefined);
    }
    emit("SIGNED_IN", session);
    return session;
  }

  function parsePending(raw: string | null): PendingRedirect | null {
    try {
      const pending = raw ? JSON.parse(raw) : null;
      return pending && typeof pending.verifier === "string" && Date.now() - pending.createdAt < REDIRECT_TTL_MS
        ? pending
        : null;
    } catch {
      return null;
    }
  }

  // Reads and removes a sign-in's entry with no await in between, so this tab can complete it only once.
  function takePending(state: string): PendingRedirect | null {
    try {
      const store = pendingStorage();
      const raw = store.getItem(pendingPrefix + state);
      store.removeItem(pendingPrefix + state);
      return parsePending(raw);
    } catch {
      return null;
    }
  }

  async function redirect(opts: SignInRedirectOptions = {}, stepUpUser: string | null = null): Promise<void> {
    const verifier = randomString(32);
    const state = randomString(16);
    const redirectUri = opts.redirectUri ?? defaultRedirectUri();
    const url = new URL(`${key.apiBase}/sign-in/`);
    const query: Record<string, string | undefined> = {
      redirect_uri: redirectUri,
      state,
      code_challenge: await codeChallenge(verifier),
      code_challenge_method: "S256",
      language: language(opts.language)
    };
    const store = pendingStorage();

    // Forget sign-ins abandoned in any tab (closed pages, links never opened).
    for (const name of Array.from({ length: store.length }, (_, index) => store.key(index))) {
      if (name?.startsWith(pendingPrefix) && !parsePending(store.getItem(name))) store.removeItem(name);
    }
    const pending: PendingRedirect = {
      verifier,
      redirectUri,
      returnTo: opts.returnTo ?? null,
      stepUpUser,
      createdAt: Date.now()
    };
    store.setItem(pendingPrefix + state, JSON.stringify(pending));
    for (const [name, value] of Object.entries(query)) if (value) url.searchParams.set(name, value);
    await (options.navigate ? options.navigate(url.href) : location.assign(url.href));
  }

  async function handleRedirectCallback(url?: string) {
    const current = typeof location === "undefined" ? undefined : location.href;
    if (!url && !current) throw new DiditAuthError("invalid_request", "Pass the redirect address.");
    const address = new URL((url || current) as string);
    const state = address.searchParams.get("state");
    const code = address.searchParams.get("code");

    if (address.href === current) {
      // Keep the one-time code out of the address bar, history and later reloads.
      const clean = new URL(address.href);
      ["code", "state", "error"].forEach((name) => clean.searchParams.delete(name));
      history.replaceState(history.state, "", clean.href);
    }
    const pending = state ? takePending(state) : null;

    if (!pending) {
      throw new DiditAuthError("invalid_state", "This sign-in was not started in this browser, or it expired.");
    }
    if (!code) throw new DiditAuthError(address.searchParams.get("error") || "invalid_request");
    return {
      session: await exchange(code, pending.verifier, pending.redirectUri, pending.stepUpUser),
      returnTo: pending.returnTo
    };
  }

  async function begin(stepUpUser?: string): Promise<Attempt> {
    const verifier = randomString(32);
    const state = randomString(16);
    const redirectUri = defaultRedirectUri();
    const { transaction } = await request<{ transaction: string }>("authorize/", {
      body: {
        redirect_uri: redirectUri,
        state,
        code_challenge: await codeChallenge(verifier),
        code_challenge_method: "S256"
      }
    });

    return { transaction, verifier, state, redirectUri, stepUpUser };
  }

  function sent(next: Attempt, response: ChallengeResponse): DiditSignInResult {
    attempt = { ...next, challenge: response.challenge };
    return { status: "code_sent", expiresIn: response.expires_in };
  }

  function waitingFor(step: NonNullable<Attempt["step"]>): Attempt {
    if (attempt?.step !== step) {
      throw new DiditAuthError("no_pending_attempt", "Start this sign-in step before submitting its code.");
    }
    return attempt;
  }

  async function settle(current: Attempt, result: ProofResponse): Promise<DiditSignInResult> {
    if (result.code) {
      if (result.state !== current.state) throw new DiditAuthError("invalid_state");
      const session = await exchange(result.code, current.verifier, current.redirectUri, current.stepUpUser);
      return result.recovery_codes
        ? { status: "signed_in", session, recoveryCodes: result.recovery_codes }
        : { status: "signed_in", session };
    }
    if (!result.challenge) throw new DiditAuthError("server_error", "Unexpected answer from the Didit API.");
    if (result.mfa_enrollment_required) {
      attempt = { ...current, step: "mfa_setup", challenge: result.challenge };
      return { status: "mfa_enrollment_required", uri: result.uri ?? "" };
    }
    attempt = { ...current, step: "mfa", challenge: result.challenge };
    return { status: "mfa_required" };
  }

  async function passkeySignIn(stepUpUser?: string): Promise<DiditSignInResult> {
    const current = await begin(stepUpUser);
    const { challenge, options: json } = await request<PasskeyResponse>("passkeys/begin/", {
      body: { transaction: current.transaction }
    });

    assertPasskeysAvailable(json.rpId);
    const credential = await runCeremony(() => navigator.credentials.get({ publicKey: requestOptions(json) }));
    return settle(
      current,
      await request<ProofResponse>("passkeys/complete/", { body: { challenge, credential: credentialJSON(credential) } })
    );
  }

  function getSession({ force = false } = {}): Promise<DiditSession | null> {
    if (sessionRequest && !force) return sessionRequest;
    const run = (async () => {
      const tokens = await currentTokens();
      if (!tokens) return null;
      if (!force && cached?.sessionId === tokens.sessionId && Date.now() - cached.at < SESSION_CACHE_MS) {
        return cached.session;
      }
      try {
        const body = await authed<SessionResponse>("session/");
        const latest = await readTokens();
        if (!latest) return null;
        const session = toSession(body, latest.accessToken);
        cached = { session, sessionId: latest.sessionId, at: Date.now() };
        return session;
      } catch (error) {
        if (error instanceof DiditAuthError && error.code === "not_signed_in") return null;
        throw error;
      }
    })().finally(() => {
      if (sessionRequest === run) sessionRequest = null;
    });

    sessionRequest = run;
    return run;
  }

  async function onOtherTab(oldValue: string | null): Promise<void> {
    // A storage event can arrive after later changes, including this tab's own: report the change from
    // what this tab last knew to what is stored now, and nothing when that is no change at all.
    const value = await storage().getItem(storageKey);
    const previous = observed === undefined ? oldValue : observed;
    observed = value;
    if (value === previous) return;
    const before = parseTokens(previous);
    const after = parseTokens(value);

    if (!after) {
      cached = null;
      attempt = null;
      if (before) emit("SIGNED_OUT", null);
    } else if (before?.sessionId === after.sessionId) {
      emit("TOKEN_REFRESHED", cached?.session ?? null);
    } else {
      cached = null;
      emit("SIGNED_IN", await getSession().catch(() => null));
    }
  }

  function sharedAcrossTabs(): boolean {
    try {
      return typeof window !== "undefined" && storage() === window.localStorage;
    } catch {
      return false;
    }
  }

  return {
    applicationId: key.applicationId,

    signIn: (opts) => redirect(opts),
    handleRedirectCallback,
    getSession,

    async getToken() {
      return (await currentTokens())?.accessToken ?? null;
    },

    onAuthStateChange(listener) {
      listeners.add(listener);
      if (!stopSync && sharedAcrossTabs()) {
        const handler = (event: StorageEvent) => {
          if (event.key === storageKey) void onOtherTab(event.oldValue);
        };
        window.addEventListener("storage", handler);
        stopSync = () => window.removeEventListener("storage", handler);
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size && stopSync) {
          stopSync();
          stopSync = null;
        }
      };
    },

    async signOut() {
      const tokens = await withTokenLock(async () => {
        const tokens = await lockedTokens();
        await signedOut(tokens);
        return tokens;
      });
      // Best effort: the local sign-out stands even when Didit cannot be reached.
      if (tokens) await endSession(tokens).catch(() => undefined);
    },

    async stepUp(opts: StepUpOptions = {}) {
      const current = await getSession({ force: true });
      if (!current) throw new DiditAuthError("not_signed_in", "Sign in first.");
      if (opts.method === "passkey") {
        const result = await passkeySignIn(current.userId);
        return result.status === "signed_in" ? result.session : null;
      }
      await redirect(opts, current.userId);
      return null;
    },

    password: {
      async signIn({ email, password }) {
        const current = await begin();
        return settle(
          current,
          await request<ProofResponse>("password/", { body: { transaction: current.transaction, email, password } })
        );
      },
      async signUp({ email, password, invitation, language: lang }) {
        const current = await begin();
        return sent(
          { ...current, step: "email", purpose: "signup", invitation },
          await request<ChallengeResponse>("email/start/", {
            body: { transaction: current.transaction, purpose: "signup", email, password, language: language(lang) }
          })
        );
      },
      async requestReset({ email, language: lang }) {
        const response = await request<{ expires_in: number }>("password-reset/start/", {
          body: { email, language: language(lang) }
        });
        return { expiresIn: response.expires_in };
      }
    },

    emailCode: {
      async start({ email, invitation, language: lang }) {
        const current = await begin();
        return sent(
          { ...current, step: "email", purpose: "login", invitation },
          await request<ChallengeResponse>("email/start/", {
            body: { transaction: current.transaction, purpose: "login", email, language: language(lang) }
          })
        );
      },
      async verify({ code }) {
        const current = waitingFor("email");
        return settle(
          current,
          await request<ProofResponse>("email/complete/", {
            body: {
              transaction: current.transaction,
              purpose: current.purpose,
              challenge: current.challenge,
              code,
              invitation: current.invitation
            }
          })
        );
      }
    },

    phone: {
      async start({ phone, channel, language: lang }) {
        const current = await begin();
        return sent(
          { ...current, step: "phone" },
          await request<ChallengeResponse>("phone/start/", {
            body: { transaction: current.transaction, phone, channel, language: language(lang) }
          })
        );
      },
      async verify({ code }) {
        const current = waitingFor("phone");
        return settle(
          current,
          await request<ProofResponse>("phone/complete/", {
            body: { transaction: current.transaction, challenge: current.challenge, code }
          })
        );
      }
    },

    magicLink: {
      signIn: (opts) => redirect(opts)
    },

    social: {
      signIn: (opts) => redirect(opts)
    },

    passkeys: {
      signIn: () => passkeySignIn(),
      async register() {
        const { challenge, options: json } = await authed<PasskeyResponse>("passkeys/register/", { body: {} });

        assertPasskeysAvailable(json.rp?.id);
        const credential = await runCeremony(() => navigator.credentials.create({ publicKey: creationOptions(json) }));
        const result = await authed<{ id: string }>("passkeys/confirm/", {
          body: { challenge, credential: credentialJSON(credential) }
        });
        return { id: String(result.id) };
      }
    },

    mfa: {
      async verify({ code }) {
        const current = waitingFor("mfa");
        return settle(
          current,
          await request<ProofResponse>("mfa/complete/", { body: { challenge: current.challenge, code } })
        );
      },
      async setup({ code }) {
        const current = waitingFor("mfa_setup");
        return settle(current, await request<ProofResponse>("mfa/setup/", { body: { challenge: current.challenge, code } }));
      },
      async enroll() {
        const response = await authed<{ challenge: string; uri: string }>("mfa/enroll/", { body: {} });
        enrollment = response.challenge;
        return { uri: response.uri };
      },
      async confirm({ code }) {
        if (!enrollment) throw new DiditAuthError("no_pending_attempt", "Call mfa.enroll() first.");
        const response = await authed<{ recovery_codes: string[] }>("mfa/confirm/", {
          body: { challenge: enrollment, code }
        });
        enrollment = null;
        return { recoveryCodes: response.recovery_codes };
      }
    },

    agents: {
      async list() {
        const grants: DiditAgentGrant[] = [];
        for (let offset = 0; ; offset += GRANTS_PAGE) {
          const page = await authed<{ count: number; results: GrantResponse[] }>(
            `grants/?limit=${GRANTS_PAGE}&offset=${offset}`
          );
          for (const grant of page.results) {
            grants.push({
              id: String(grant.id),
              agentId: String(grant.agent_id),
              agentName: grant.agent__name,
              scopes: grant.scopes,
              expiresAt: grant.expires_at,
              revokedAt: grant.revoked_at
            });
          }
          if (page.results.length < GRANTS_PAGE || grants.length >= page.count) return grants;
        }
      },
      async revoke(grantId) {
        await authed(`grants/${encodeURIComponent(grantId)}/`, { method: "DELETE" });
      },
      async consent({ challenge, decision }) {
        const response = await authed<ProofResponse>("agents/consent/", { body: { challenge, decision } });
        return response.code && response.redirect_uri && response.state
          ? { status: "approved", redirectTo: withCode(response.redirect_uri, response.code, response.state) }
          : { status: "denied" };
      }
    }
  };
}
