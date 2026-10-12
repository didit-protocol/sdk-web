// Types-only stand-in for the headless core, @didit-protocol/auth, which ships
// separately. It declares the part of the core's contract this package uses:
// createDiditAuth, the hosted signIn with PKCE, handleRedirectCallback,
// getSession, getToken, onAuthStateChange, signOut, stepUp and agents. Delete
// this file once the core package is part of the workspace; core.ts is the
// only module that imports it.
declare module "@didit-protocol/auth" {
  export interface DiditAuthOptions {
    publishableKey: string;
    frontendApi?: string;
    redirectUri?: string;
  }

  export interface DiditAuthUser {
    id: string;
    email: string | null;
    emailVerified: boolean;
    phone: string | null;
    vendorData: string | null;
    verifiedIdentity: Record<string, unknown> | null;
    organizations: { id: string; name: string; role: string }[];
  }

  export interface DiditAuthSession {
    id: string;
    user: DiditAuthUser;
    methods: string[];
    mfaVerified: boolean;
    expiresAt: string;
  }

  export interface DiditAuthGrant {
    id: string;
    agentId: string;
    agentName: string;
    scopes: string[];
    expiresAt: string;
    revokedAt: string | null;
  }

  export interface DiditAuthClient {
    signIn(options?: { returnTo?: string; screen?: "sign-in" | "sign-up" }): Promise<void>;
    /** Completes a sign-in redirect on the current URL; `null` when the URL is not one. */
    handleRedirectCallback(): Promise<{ returnTo: string | null } | null>;
    getSession(): Promise<DiditAuthSession | null>;
    getToken(): Promise<string | null>;
    onAuthStateChange(listener: (session: DiditAuthSession | null) => void): () => void;
    signOut(): Promise<void>;
    stepUp(options?: { returnTo?: string }): Promise<void>;
    agents: {
      list(): Promise<DiditAuthGrant[]>;
      revoke(id: string): Promise<void>;
    };
  }

  export function createDiditAuth(options: DiditAuthOptions): DiditAuthClient;
}
