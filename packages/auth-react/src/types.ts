/** A customer organization the person belongs to, when organizations are on. */
export interface DiditOrganization {
  id: string;
  name: string;
  role: string;
}

/** The signed-in person, as Didit Authentication reports them. */
export interface DiditUser {
  /** The Didit identity id (`sub`). */
  id: string;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  /**
   * Your own id for this person (`vendor_data`), shared with Didit's identity
   * verification and transaction monitoring. `null` until the token carries it.
   */
  vendorData: string | null;
  /** Verified identity claims the person shared with your application. */
  verifiedIdentity: Record<string, unknown> | null;
  organizations: DiditOrganization[];
}

export interface DiditSession {
  /** The session id (`sid`). */
  id: string;
  user: DiditUser;
  /** How the person signed in, for example `password`, `passkey` or `code`. */
  methods: string[];
  mfaVerified: boolean;
  /** ISO 8601 time when the session ends. */
  expiresAt: string;
}

export type AuthStatus = "loading" | "signed-in" | "signed-out";

export interface AuthSnapshot {
  status: AuthStatus;
  session: DiditSession | null;
}

/** An AI agent the person allowed to act for them. */
export interface AgentGrant {
  id: string;
  agentId: string;
  agentName: string;
  scopes: string[];
  /** ISO 8601 time when the grant ends. */
  expiresAt: string;
  /** ISO 8601 time when the grant was revoked, or `null` while it is live. */
  revokedAt: string | null;
}

export interface RedirectOptions {
  /** A path in your app to return to afterwards, for example `/account`. */
  redirectUrl?: string;
}

/** A sensitive action your application's step-up rules can apply to. */
export type StepUpAction = "payout" | "bank" | "contact";

export interface StepUpOptions {
  /** `payout`, `bank` (adding or changing a bank account) or `contact` (changing the email or phone). */
  action: StepUpAction;
  /** The payout's amount, a decimal such as `"900.00"` (payouts only). */
  amount?: string | number;
  /** The payout's ISO 4217 currency, such as `"USD"`. */
  currency?: string;
}

/** A step-up as Didit recorded it. Your backend reads it again before acting. */
export interface StepUpResult {
  /** The step-up's id; `null` when no rule asked for one. */
  id: string | null;
  /** `not_required`, `pending`, `approved`, `review`, `declined` or `expired`. */
  status: "not_required" | "pending" | "approved" | "review" | "declined" | "expired" | (string & {});
  /** The action may go ahead: no step-up was needed, or the person passed it. */
  approved: boolean;
  /** The rule that asked for it: `payout`, `bank`, `contact` or `device` (a new device). */
  rule: string | null;
  /** The check the person takes: `liveness`, `selfie` or `full_id`. */
  method: string | null;
}

/** What the person can prove themselves with when bot and risk protection asks. */
export type ProtectionMethod = "email_code" | "passkey";

/** Outcome of a headless sign-in step. Anything other than `signed_in` waits for the next call. */
export type SignInResult =
  | { status: "signed_in"; session: DiditSession; recoveryCodes?: string[] }
  /** A six-digit code was sent; finish with `emailCode.verify` or `phone.verify`. */
  | { status: "code_sent"; expiresIn: number }
  /** Finish with `mfa.verify` (authenticator or recovery code). */
  | { status: "mfa_required" }
  /** The person must add an authenticator: show `uri` as a QR code, then call `mfa.setup`. */
  | { status: "mfa_enrollment_required"; uri: string }
  /**
   * Didit's bot and risk protection asks for one more proof: a code it emailed the person
   * (`protection.verify`) or one of their passkeys (`protection.passkey`), as `methods` lists.
   */
  | { status: "protection_required"; methods: ProtectionMethod[]; expiresIn: number };

/** Sign-in steps for your own screens. Each resolves with what to ask the person for next. */
export interface HeadlessSignIn {
  password: {
    signIn(input: { email: string; password: string }): Promise<SignInResult>;
  };
  emailCode: {
    start(input: { email: string }): Promise<SignInResult>;
    verify(input: { code: string }): Promise<SignInResult>;
  };
  phone: {
    start(input: { phone: string; channel?: "sms" | "whatsapp" }): Promise<SignInResult>;
    verify(input: { code: string }): Promise<SignInResult>;
  };
  /** Completes a sign-in that answered `protection_required`. */
  protection: {
    /** With the code Didit emailed (`email_code`). */
    verify(input: { code: string }): Promise<SignInResult>;
    /** With one of the person's passkeys (`passkey`), on the Didit sign-in domain only. */
    passkey(): Promise<SignInResult>;
  };
  mfa: {
    /** Completes a sign-in that answered `mfa_required`. */
    verify(input: { code: string }): Promise<SignInResult>;
    /** Completes a sign-in that answered `mfa_enrollment_required`; the result has the recovery codes. */
    setup(input: { code: string }): Promise<SignInResult>;
  };
}

/**
 * What the components and hooks need from an authentication client. The
 * browser client of `@didit-protocol/auth` and the server-backed client of
 * `@didit-protocol/auth-nextjs` both provide it.
 */
export interface AuthClient extends HeadlessSignIn {
  getSnapshot(): AuthSnapshot;
  subscribe(listener: () => void): () => void;
  /** Resolves the session once: restores it, or completes a sign-in redirect. */
  load(): Promise<void>;
  signIn(options?: RedirectOptions): Promise<void>;
  signUp(options?: RedirectOptions): Promise<void>;
  signOut(options?: RedirectOptions): Promise<void>;
  /**
   * Asks Didit whether `action` needs a step-up. When one of your application's rules applies, opens
   * the identity check (liveness, a selfie or an ID); the person comes back to this page, where
   * `handleStepUpCallback` reads the outcome.
   */
  stepUp(options: StepUpOptions): Promise<StepUpResult>;
  /** Reads Didit's record of the step-up the current address (or `url`) came back from. */
  handleStepUpCallback(url?: string): Promise<StepUpResult>;
  /** Signs the current person in again on the hosted page, for actions that need a fresh session. */
  reauthenticate(options?: RedirectOptions): Promise<void>;
  /** A short-lived access token for your own API, or `null` when signed out. */
  getToken(): Promise<string | null>;
  listAgents(): Promise<AgentGrant[]>;
  revokeAgent(id: string): Promise<void>;
}

export interface Appearance {
  /** `auto` follows the device setting. Defaults to `auto`. */
  theme?: "light" | "dark" | "auto";
  /** Accent for avatars and focus rings. Defaults to Didit blue. */
  brandColor?: string;
  /** Defaults to the font of the surrounding page. */
  fontFamily?: string;
}
