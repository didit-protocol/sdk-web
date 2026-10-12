import type { DeviceSignalsOption } from "./device";
import type { DiditAuthStorageOption } from "./storage";

/** Languages of the hosted pages and of the emails and messages Didit sends. */
export type DiditAuthLanguage = "en" | "es" | "fr" | "de" | "ja";

export type DiditSocialProvider = "google" | "microsoft" | "apple" | "github";

export interface DiditAuthOptions {
  /** The application's publishable key (`pk_live_...` or `pk_test_...`). */
  publishableKey: string;
  /**
   * Where Didit sends the person back after the hosted page. It must match one
   * of the application's registered redirect addresses exactly, and is also
   * bound to every headless sign-in. Defaults to the current page without its
   * query string.
   */
  redirectUri?: string;
  /**
   * Where the session tokens are kept: "local" (the default, shared by the
   * tabs of this origin), "session" (this tab only), "memory" (lost on
   * reload) or your own store.
   */
  storage?: DiditAuthStorageOption;
  /** Language of the hosted page and of the codes and links Didit sends. Defaults to the browser's language. */
  language?: DiditAuthLanguage;
  /**
   * Device signals on auth requests. "auto" (the default) sends them when the
   * page and the Didit API share an origin; "always" also sends them across
   * origins; "off" never does.
   */
  deviceSignals?: DeviceSignalsOption;
  /**
   * Opens the hosted page. Defaults to `location.assign`; pass your router or
   * an in-app browser opener instead.
   */
  navigate?: (url: string) => void | Promise<void>;
  /** A fetch implementation, for runtimes without a global one. */
  fetch?: typeof fetch;
}

export interface DiditOrganization {
  id: string;
  name: string;
  role: string;
}

export interface DiditSession {
  /** The person's Didit identity id (the token's `sub`). */
  userId: string;
  sessionId: string;
  applicationId: string;
  /**
   * The id that ties this person to their verifications and transactions:
   * your own external id when you gave one, otherwise the Didit identity id.
   * Null until the API reports it.
   */
  vendorData: string | null;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  /** How the session was created, for example ["password"] or ["passkey"]. */
  methods: string[];
  mfaVerified: boolean;
  /** Verified identity claims when the person signed in with a Didit ID Wallet. */
  verifiedIdentity: Record<string, unknown> | null;
  /** Customer organizations the person belongs to, when organizations are on. */
  organizations: DiditOrganization[];
  /** When the session ends (ISO 8601). */
  expiresAt: string;
}

export type DiditAuthEvent = "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED";

export type DiditAuthListener = (event: DiditAuthEvent, session: DiditSession | null) => void;

/** Outcome of a headless step. Anything other than "signed_in" waits for the next call. */
export type DiditSignInResult =
  | { status: "signed_in"; session: DiditSession; recoveryCodes?: string[] }
  /** A six-digit code was sent; finish with `emailCode.verify` or `phone.verify`. */
  | { status: "code_sent"; expiresIn: number }
  /** Finish with `mfa.verify` (authenticator or recovery code). */
  | { status: "mfa_required" }
  /** The person must add an authenticator: show `uri` as a QR code, then call `mfa.setup`. */
  | { status: "mfa_enrollment_required"; uri: string };

export interface SignInRedirectOptions {
  /** Overrides the client's redirect address for this sign-in. */
  redirectUri?: string;
  /** Returned by `handleRedirectCallback`, for example the page to show next. */
  returnTo?: string;
  language?: DiditAuthLanguage;
}

export interface DiditRedirectResult {
  session: DiditSession;
  returnTo: string | null;
}

export interface StepUpOptions extends SignInRedirectOptions {
  /**
   * "redirect" (the default) signs the person in again on the hosted page;
   * "passkey" asks for their passkey on this page (Didit sign-in domain only).
   */
  method?: "redirect" | "passkey";
}

export interface DiditAgentGrant {
  id: string;
  agentId: string;
  agentName: string;
  scopes: string[];
  expiresAt: string;
  revokedAt: string | null;
}

export type DiditAgentConsentResult = { status: "approved"; redirectTo: string } | { status: "denied" };

export interface DiditAuth {
  readonly applicationId: string;
  /** Opens the hosted sign-in page. Resolves once the navigation starts. */
  signIn(options?: SignInRedirectOptions): Promise<void>;
  /** Completes a hosted sign-in on the redirect page; reads the current address by default. */
  handleRedirectCallback(url?: string): Promise<DiditRedirectResult>;
  /** The signed-in person, or null. Cached briefly; pass `force` to ask the API again. */
  getSession(options?: { force?: boolean }): Promise<DiditSession | null>;
  /** A valid access token for your backend (refreshed when needed), or null. */
  getToken(): Promise<string | null>;
  /** Subscribes to sign-in, sign-out and refresh events, also from other tabs. Returns the unsubscribe function. */
  onAuthStateChange(listener: DiditAuthListener): () => void;
  /** Ends the session at Didit and forgets it here. */
  signOut(): Promise<void>;
  /** Signs the current person in again (for sensitive actions) and checks it is the same person. */
  stepUp(options?: StepUpOptions): Promise<DiditSession | null>;
  password: {
    signIn(input: { email: string; password: string }): Promise<DiditSignInResult>;
    /** Sends a code to confirm the address; finish with `emailCode.verify`. */
    signUp(input: {
      email: string;
      password: string;
      invitation?: string;
      language?: DiditAuthLanguage;
    }): Promise<DiditSignInResult>;
    /** Emails a reset link to the hosted reset page. Answers the same for unknown addresses. */
    requestReset(input: { email: string; language?: DiditAuthLanguage }): Promise<{ expiresIn: number }>;
  };
  emailCode: {
    start(input: { email: string; invitation?: string; language?: DiditAuthLanguage }): Promise<DiditSignInResult>;
    verify(input: { code: string }): Promise<DiditSignInResult>;
  };
  phone: {
    start(input: {
      phone: string;
      channel?: "sms" | "whatsapp";
      language?: DiditAuthLanguage;
    }): Promise<DiditSignInResult>;
    verify(input: { code: string }): Promise<DiditSignInResult>;
  };
  /** Magic links are sent from the hosted page; the link completes in whichever tab opens it. */
  magicLink: {
    signIn(options?: SignInRedirectOptions): Promise<void>;
  };
  /** Social sign-in runs on the hosted page with the application's own provider credentials. */
  social: {
    signIn(input: { provider: DiditSocialProvider } & SignInRedirectOptions): Promise<void>;
  };
  passkeys: {
    signIn(): Promise<DiditSignInResult>;
    /** Adds a passkey to the signed-in person (needs a session at most five minutes old). */
    register(): Promise<{ id: string }>;
  };
  mfa: {
    /** Completes a sign-in that answered "mfa_required". */
    verify(input: { code: string }): Promise<DiditSignInResult>;
    /** Completes a sign-in that answered "mfa_enrollment_required"; returns the recovery codes. */
    setup(input: { code: string }): Promise<DiditSignInResult>;
    /** Starts adding an authenticator to the signed-in person; show `uri` as a QR code. */
    enroll(): Promise<{ uri: string }>;
    /** Confirms the authenticator added with `enroll`. */
    confirm(input: { code: string }): Promise<{ recoveryCodes: string[] }>;
  };
  agents: {
    list(): Promise<DiditAgentGrant[]>;
    revoke(grantId: string): Promise<void>;
    /** Approves or denies an AI agent's access request for the signed-in person. */
    consent(input: { challenge: string; decision: "approve" | "deny" }): Promise<DiditAgentConsentResult>;
  };
}
