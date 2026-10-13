import type { DeviceSignalsOption } from "./device";
import type { DiditAuthStorageOption } from "./storage";

/** Languages of the hosted pages and of the emails and messages Didit sends. */
export type DiditAuthLanguage = "en" | "es" | "fr" | "de" | "ja";

export interface DiditAuthOptions {
  /** The application's publishable key (`pk_live_...` or `pk_test_...`), from the Didit console. */
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
  | { status: "mfa_enrollment_required"; uri: string }
  /**
   * Didit's bot and risk protection asks for one more proof before signing the person in. `methods`
   * lists what they can use: "email_code" (a code was emailed to them; finish with `protection.verify`)
   * and "passkey" (finish with `protection.passkey`). The proof expires after `expiresIn` seconds.
   */
  | { status: "protection_required"; methods: DiditProtectionMethod[]; expiresIn: number };

export type DiditProtectionMethod = "email_code" | "passkey";

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

export interface ReauthenticateOptions extends SignInRedirectOptions {
  /**
   * "redirect" (the default) signs the person in again on the hosted page;
   * "passkey" asks for their passkey on this page (Didit sign-in domain only).
   */
  method?: "redirect" | "passkey";
}

/** A sensitive action your application's step-up rules can apply to. */
export type DiditStepUpAction = "payout" | "bank" | "contact";

export interface StepUpOptions {
  /** "payout", "bank" (adding or changing a bank account) or "contact" (changing the email or phone). */
  action: DiditStepUpAction;
  /** The payout's amount, a decimal such as "900.00" (payouts only). */
  amount?: string | number;
  /** The payout's ISO 4217 currency, such as "USD". */
  currency?: string;
  /**
   * Where Didit sends the person back once they pass the check. It must match one of the
   * application's registered redirect addresses exactly. Defaults to the client's `redirectUri`.
   */
  redirectUri?: string;
}

/**
 * A step-up as Didit recorded it. Before acting, your backend reads it again with
 * `GET step-up/{id}/`: what a browser reports can be changed, Didit's record cannot.
 */
export interface DiditStepUpResult {
  /** The step-up's id; null when no rule asked for one. */
  id: string | null;
  /** "not_required", "pending", "approved", "review", "declined" or "expired". */
  status: "not_required" | "pending" | "approved" | "review" | "declined" | "expired" | (string & {});
  /** The action may go ahead: no step-up was needed, or the person passed it. */
  approved: boolean;
  /** The rule that asked for it: "payout", "bank", "contact" or "device" (a new device). */
  rule: string | null;
  /** The check the person takes: "liveness", "selfie" or "full_id". */
  method: string | null;
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
  /**
   * Asks Didit whether `action` needs a step-up. When one of your application's rules applies, opens
   * the identity check (liveness, a selfie or an ID) and resolves once the navigation starts; the
   * person comes back to `redirectUri`, where `handleStepUpCallback` reads the outcome.
   */
  stepUp(options: StepUpOptions): Promise<DiditStepUpResult>;
  /** Reads the outcome of the step-up the current address (or `url`) came back from. */
  handleStepUpCallback(url?: string): Promise<DiditStepUpResult>;
  /**
   * Signs the current person in again and checks it is the same person, for actions that need a
   * session at most five minutes old or created with a passkey.
   */
  reauthenticate(options?: ReauthenticateOptions): Promise<DiditSession | null>;
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
  /**
   * Social sign-in runs on the hosted page with the application's own provider
   * credentials. The page lists every provider the application enabled: it
   * cannot open on one chosen provider yet.
   */
  social: {
    signIn(options?: SignInRedirectOptions): Promise<void>;
  };
  passkeys: {
    signIn(): Promise<DiditSignInResult>;
    /** Adds a passkey to the signed-in person (needs a session at most five minutes old). */
    register(): Promise<{ id: string }>;
  };
  /** Completes a sign-in that answered "protection_required". */
  protection: {
    /** With the code Didit emailed ("email_code"). */
    verify(input: { code: string }): Promise<DiditSignInResult>;
    /** With one of the person's passkeys ("passkey"), on the Didit sign-in domain. */
    passkey(): Promise<DiditSignInResult>;
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
