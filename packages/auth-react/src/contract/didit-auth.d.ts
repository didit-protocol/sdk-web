// Build-time declarations for the separately released headless peer. Keep this
// subset aligned with its public API; the browser integration tests also run
// against the peer itself when DIDIT_AUTH_CORE_ENTRY is supplied.
declare module "@didit-protocol/auth" {
  export interface DiditAuthOptions {
    publishableKey: string;
    redirectUri?: string;
    language?: "en" | "es" | "fr" | "de" | "ja";
  }

  export interface DiditSession {
    sessionId: string;
    userId: string;
    email: string | null;
    emailVerified: boolean;
    phone: string | null;
    vendorData: string | null;
    verifiedIdentity: Record<string, unknown> | null;
    organizations: { id: string; name: string; role: string }[];
    methods: string[];
    mfaVerified: boolean;
    expiresAt: string;
  }

  export interface DiditAgentGrant {
    id: string;
    agentId: string;
    agentName: string;
    scopes: string[];
    expiresAt: string;
    revokedAt: string | null;
  }

  export interface DiditAuth {
    signIn(options?: { returnTo?: string }): Promise<void>;
    handleRedirectCallback(): Promise<{ session: DiditSession; returnTo: string | null }>;
    getSession(): Promise<DiditSession | null>;
    getToken(): Promise<string | null>;
    onAuthStateChange(listener: (event: string, session: DiditSession | null) => void): () => void;
    signOut(): Promise<void>;
    stepUp(options?: { returnTo?: string }): Promise<DiditSession | null>;
    agents: {
      list(): Promise<DiditAgentGrant[]>;
      revoke(id: string): Promise<void>;
    };
  }

  export function createDiditAuth(options: DiditAuthOptions): DiditAuth;
}
