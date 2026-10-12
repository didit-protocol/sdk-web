import { deviceHeaders, deviceSignalsEnabled } from "./device";
import { codeChallenge, decodeText, randomString } from "./encoding";
import { DiditAuthError } from "./errors";
import { createHttpClient, type RequestOptions } from "./http";
import { parsePublishableKey } from "./key";
import { memoryStorage, resolveStorage, webStorage, type DiditAuthStorage } from "./storage";
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
const PROVIDERS = ["google", "microsoft", "apple", "github"];
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

/** A hosted sign-in waiting for its redirect, keyed by its state. */
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
  const pendingKey = `${storageKey}:pending`;
  const signals = options.deviceSignals ?? "auto";
  const request = createHttpClient(key.apiBase, options.fetch ?? ((input, init) => fetch(input, init)), () =>
    deviceSignalsEnabled(signals, key.apiBase) ? deviceHeaders() : Promise.resolve({})
  );
  const listeners = new Set<DiditAuthListener>();
  let tokenStore: DiditAuthStorage | null = null;
  let pendingStore: DiditAuthStorage | null = null;
  let cached: { session: DiditSession; sessionId: string; at: number } | null = null;
  let sessionRequest: Promise<DiditSession | null> | null = null;
  let refreshing: Promise<Tokens | null> | null = null;
  let attempt: Attempt | null = null;
  let enrollment: string | null = null;
  let stopSync: (() => void) | null = null;

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

  async function writeTokens(tokens: Tokens | null): Promise<void> {
    if (tokens) await storage().setItem(storageKey, JSON.stringify(tokens));
    else await storage().removeItem(storageKey);
  }

  async function signedOut(): Promise<void> {
    const had = await readTokens();
    await writeTokens(null);
    cached = null;
    attempt = null;
    enrollment = null;
    if (had) emit("SIGNED_OUT", null);
  }

  function refresh(stale: Tokens): Promise<Tokens | null> {
    const run = async (): Promise<Tokens | null> => {
      // Another tab may have rotated the tokens while this one waited for the lock. Presenting
      // an already used refresh token revokes the whole session, so use theirs instead.
      const latest = await readTokens();
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
        await signedOut();
        return null;
      }
    };
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;

    if (!refreshing) {
      // The Web Locks API serializes refreshes across this origin's tabs. It resolves
      // with the callback's settled value, which its DOM typing models as a nested promise.
      const task = locks ? (locks.request(`${storageKey}:refresh`, run) as unknown as Promise<Tokens | null>) : run();
      refreshing = task.finally(() => {
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
    const previous = await readTokens();
    await writeTokens(tokens);
    cached = { session, sessionId: tokens.sessionId, at: Date.now() };
    attempt = null;
    if (previous && previous.sessionId !== tokens.sessionId) {
      // This browser can no longer use the replaced session: end it at Didit too.
      await request("session/", { method: "DELETE", token: previous.accessToken }).catch(() => undefined);
    }
    emit("SIGNED_IN", session);
    return session;
  }

  async function readPending(): Promise<Record<string, PendingRedirect>> {
    try {
      const all: Record<string, PendingRedirect> = JSON.parse((await pendingStorage().getItem(pendingKey)) || "{}");
      for (const [state, pending] of Object.entries(all)) {
        if (!(Date.now() - pending.createdAt < REDIRECT_TTL_MS)) delete all[state];
      }
      return all;
    } catch {
      return {};
    }
  }

  async function writePending(all: Record<string, PendingRedirect>): Promise<void> {
    if (Object.keys(all).length) await pendingStorage().setItem(pendingKey, JSON.stringify(all));
    else await pendingStorage().removeItem(pendingKey);
  }

  async function redirect(opts: SignInRedirectOptions = {}, stepUpUser: string | null = null): Promise<void> {
    const verifier = randomString(32);
    const state = randomString(16);
    const redirectUri = opts.redirectUri ?? defaultRedirectUri();
    const pending = await readPending();
    const url = new URL(`${key.apiBase}/sign-in/`);
    const query: Record<string, string | undefined> = {
      redirect_uri: redirectUri,
      state,
      code_challenge: await codeChallenge(verifier),
      code_challenge_method: "S256",
      language: language(opts.language)
    };

    pending[state] = { verifier, redirectUri, returnTo: opts.returnTo ?? null, stepUpUser, createdAt: Date.now() };
    await writePending(pending);
    for (const [name, value] of Object.entries(query)) if (value) url.searchParams.set(name, value);
    location.assign(url.href);
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
    const all = await readPending();
    const pending = state ? all[state] : undefined;

    if (!state || !pending) {
      throw new DiditAuthError("invalid_state", "This sign-in was not started in this browser, or it expired.");
    }
    delete all[state];
    await writePending(all);
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

  async function onOtherTab(oldValue: string | null, newValue: string | null): Promise<void> {
    const before = parseTokens(oldValue);
    const after = parseTokens(newValue);

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
          if (event.key === storageKey) void onOtherTab(event.oldValue, event.newValue);
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
      const tokens = await currentTokens().catch(() => null);
      await signedOut();
      // Best effort: the local sign-out stands even when Didit cannot be reached.
      if (tokens) await request("session/", { method: "DELETE", token: tokens.accessToken }).catch(() => undefined);
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
      async signIn({ provider, ...opts }) {
        if (!PROVIDERS.includes(provider)) throw new DiditAuthError("invalid_request", `Unknown provider: ${provider}`);
        return redirect(opts);
      }
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
