/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createAuthStore, snapshotOf } from "../store";
import type { AgentGrant, AuthClient, DiditSession, SignInResult, StepUpResult } from "../types";

/** A scenario @didit-protocol/auth recorded against a local Didit auth service (its own test fixtures). */
function recorded(scenario: string) {
  return JSON.parse(readFileSync(join(__dirname, "../../../auth/src/__tests__/fixtures", `${scenario}.json`), "utf8"));
}

const stepUpCheck = recorded("step-up-check");
const { href: _returnedTo, ...approved } = stepUpCheck.outcome;

/** What the core's stepUp and handleStepUpCallback answered: no rule, a pending check, then its approval. */
export const stepUps: Record<"notRequired" | "pending" | "approved", StepUpResult> = {
  notRequired: stepUpCheck.payout,
  pending: stepUpCheck.contact,
  approved
};

/** What the core's password sign-in answered once bot protection challenged it. */
export const protectionRequired: SignInResult = recorded("protection-email-code").challenged;

export const session: DiditSession = {
  id: "00000000-0000-4000-8000-000000000001",
  user: {
    id: "00000000-0000-4000-8000-000000000002",
    email: "maria.oliveira@example.com",
    emailVerified: true,
    phone: null,
    vendorData: null,
    verifiedIdentity: null,
    organizations: []
  },
  methods: ["password"],
  mfaVerified: false,
  expiresAt: "2099-11-11T08:30:56Z"
};

/** The Connected agents board's two agents, as the grants API returns them. */
export const grants: AgentGrant[] = [
  {
    id: "00000000-0000-4000-8000-000000000004",
    agentId: "00000000-0000-4000-8000-000000000005",
    agentName: "Agent One",
    scopes: ["balance:read", "settings:write", "payouts:request"],
    expiresAt: "2099-10-04T12:00:00Z",
    revokedAt: null
  },
  {
    id: "00000000-0000-4000-8000-000000000006",
    agentId: "00000000-0000-4000-8000-000000000007",
    agentName: "Agent Two",
    scopes: ["payouts:read"],
    expiresAt: "2099-10-19T12:00:00Z",
    revokedAt: null
  }
];

export const scopeLabels = {
  "balance:read": "Sees your balance and payouts",
  "settings:write": "changes your settings",
  "payouts:request": "requests payouts (it asks you each time)",
  "payouts:read": "Sees your payouts. Read only"
};

interface Options {
  session?: DiditSession | null | "loading";
  grants?: AgentGrant[];
  listError?: boolean;
  revokeError?: boolean;
}

/** An in-memory AuthClient: the same interface the browser and Next.js clients implement. */
export function testClient(options: Options = {}) {
  const store = createAuthStore(
    options.session === "loading" ? { status: "loading", session: null } : snapshotOf(options.session ?? null)
  );
  const client = {
    getSnapshot: store.get,
    subscribe: store.subscribe,
    load: jest.fn(async () => undefined),
    signIn: jest.fn(async () => undefined),
    signUp: jest.fn(async () => undefined),
    signOut: jest.fn(async () => store.set(snapshotOf(null))),
    stepUp: jest.fn(async () => stepUps.pending),
    handleStepUpCallback: jest.fn(async () => stepUps.approved),
    reauthenticate: jest.fn(async () => undefined),
    password: { signIn: jest.fn(async () => protectionRequired) },
    emailCode: { start: jest.fn(async () => protectionRequired), verify: jest.fn(async () => protectionRequired) },
    phone: { start: jest.fn(async () => protectionRequired), verify: jest.fn(async () => protectionRequired) },
    protection: {
      verify: jest.fn(async (): Promise<SignInResult> => ({ status: "signed_in", session: session })),
      passkey: jest.fn(async (): Promise<SignInResult> => ({ status: "signed_in", session: session }))
    },
    mfa: { verify: jest.fn(async () => protectionRequired), setup: jest.fn(async () => protectionRequired) },
    getToken: jest.fn(async () => "access-token"),
    listAgents: jest.fn(async () => {
      if (options.listError) throw new Error("unavailable");
      return options.grants ?? [];
    }),
    revokeAgent: jest.fn(async () => {
      if (options.revokeError) throw new Error("unavailable");
    })
  } satisfies AuthClient;

  return { client, store };
}
