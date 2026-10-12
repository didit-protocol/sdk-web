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

/**
 * What the components and hooks need from an authentication client. The
 * browser client of `@didit-protocol/auth` and the server-backed client of
 * `@didit-protocol/auth-nextjs` both provide it.
 */
export interface AuthClient {
  getSnapshot(): AuthSnapshot;
  subscribe(listener: () => void): () => void;
  /** Resolves the session once: restores it, or completes a sign-in redirect. */
  load(): Promise<void>;
  signIn(options?: RedirectOptions): Promise<void>;
  signUp(options?: RedirectOptions): Promise<void>;
  signOut(options?: RedirectOptions): Promise<void>;
  /** Asks the person to confirm it is them again before a sensitive action. */
  stepUp(options?: RedirectOptions): Promise<void>;
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
