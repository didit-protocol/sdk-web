import type { AgentGrant, DiditSession, StepUpResult } from "@didit-protocol/auth-react/provider";

import type { DiditAuthConfig } from "./config.js";

/** A failed call to the Frontend API. `code` is its `error` field when it sent one. */
export class DiditAuthApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null
  ) {
    super(`[didit-auth] The Frontend API answered ${status}${code ? ` (${code})` : ""}.`);
    this.name = "DiditAuthApiError";
  }

  /** The grant (code or refresh token) is spent, expired or unknown: sign in again. */
  get invalidGrant(): boolean {
    return this.status === 400 && (this.code === "invalid_grant" || this.code === "mfa_required");
  }
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  sessionId: string;
}

export type Json = Record<string, unknown>;

async function call(config: DiditAuthConfig, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${config.frontendApi}/${path}`, {
    ...init,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: { Accept: "application/json", ...init.headers }
  });
}

async function errorOf(response: Response): Promise<DiditAuthApiError> {
  let code: string | null = null;

  try {
    const body = (await response.json()) as Json;
    const error = body.error ?? (Array.isArray(body.non_field_errors) ? body.non_field_errors[0] : null);

    code = typeof error === "string" ? error : Array.isArray(error) && typeof error[0] === "string" ? error[0] : null;
  } catch {
    code = null;
  }
  return new DiditAuthApiError(response.status, code);
}

function bearer(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

function toTokens(body: Json): TokenSet {
  if (typeof body.access_token !== "string" || !/^[A-Za-z0-9_.-]{1,3800}$/.test(body.access_token) ||
      typeof body.refresh_token !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(body.refresh_token) ||
      typeof body.expires_in !== "number" || !Number.isFinite(body.expires_in) || body.expires_in <= 0 ||
      typeof body.session_id !== "string" || !body.session_id) {
    throw new DiditAuthApiError(502, "invalid_response");
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresIn: body.expires_in,
    sessionId: body.session_id
  };
}

const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

/** Maps `GET session/` to the session the components and `auth()` share. */
export function toSession(body: Json): DiditSession {
  if (typeof body.sid !== "string" || !body.sid || typeof body.sub !== "string" || !body.sub ||
      typeof body.expires_at !== "string" || !Number.isFinite(Date.parse(body.expires_at))) {
    throw new DiditAuthApiError(502, "invalid_response");
  }
  const organizations = Array.isArray(body.organizations) ? (body.organizations as Json[]) : [];
  const verified = body.verified_identity;

  return {
    id: String(body.sid),
    user: {
      id: String(body.sub),
      email: text(body.email),
      emailVerified: body.email_verified === true,
      phone: text(body.phone),
      vendorData: text(body.vendor_data),
      verifiedIdentity: verified && typeof verified === "object" ? (verified as Record<string, unknown>) : null,
      organizations: organizations.map((organization) => ({
        id: String(organization.organization_id),
        name: String(organization.organization__name ?? ""),
        role: String(organization.role ?? "")
      }))
    },
    methods: Array.isArray(body.amr) ? body.amr.map(String) : [],
    mfaVerified: body.mfa_verified === true,
    expiresAt: String(body.expires_at)
  };
}

/** Maps a step-up as `POST step-up/` and `GET step-up/{id}/` describe it. */
export function toStepUp(body: Json): StepUpResult {
  const status = body.required === false ? "not_required" : String(body.status);

  return {
    id: text(body.id),
    status,
    approved: status === "approved" || status === "not_required",
    rule: text(body.rule),
    method: text(body.method)
  };
}

/** Maps one row of `GET grants/`. */
export function toGrant(row: Json): AgentGrant {
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    agentName: String(row.agent__name ?? ""),
    scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
    expiresAt: String(row.expires_at),
    revokedAt: text(row.revoked_at)
  };
}

export interface CodeExchange {
  code: string;
  verifier: string;
  /** The browser's user agent, so the session records the person's device rather than this server. */
  userAgent: string | null;
}

export async function exchangeCode(config: DiditAuthConfig, exchange: CodeExchange): Promise<TokenSet> {
  const response = await call(config, "token/", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(exchange.userAgent ? { "User-Agent": exchange.userAgent } : {}) },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: exchange.code,
      code_verifier: exchange.verifier,
      redirect_uri: config.redirectUri
    })
  });

  if (!response.ok) throw await errorOf(response);
  return toTokens((await response.json()) as Json);
}

export async function refreshTokens(config: DiditAuthConfig, refreshToken: string): Promise<TokenSet> {
  const response = await call(config, "token/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken })
  });

  if (!response.ok) throw await errorOf(response);
  return toTokens((await response.json()) as Json);
}

/** `GET session/` as Didit answers it, or `null` when the token is no longer valid. */
export async function fetchSessionBody(config: DiditAuthConfig, accessToken: string): Promise<Json | null> {
  const response = await call(config, "session/", { headers: bearer(accessToken) });

  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw await errorOf(response);
  return (await response.json()) as Json;
}

/** The session behind an access token, or `null` when the token is no longer valid. */
export async function fetchSession(config: DiditAuthConfig, accessToken: string): Promise<DiditSession | null> {
  const body = await fetchSessionBody(config, accessToken);

  return body && toSession(body);
}

/** Ends the session everywhere. An already invalid token is not an error. */
export async function endSession(config: DiditAuthConfig, accessToken: string): Promise<void> {
  const response = await call(config, "session/", { method: "DELETE", headers: bearer(accessToken) });

  if (!response.ok && response.status !== 401 && response.status !== 403) throw await errorOf(response);
}

export async function listGrants(config: DiditAuthConfig, accessToken: string): Promise<AgentGrant[]> {
  const grants: AgentGrant[] = [];

  for (let offset = 0; ; offset += 100) {
    const path = `grants/?limit=100${offset ? `&offset=${offset}` : ""}`;
    const response = await call(config, path, { headers: bearer(accessToken) });

    if (!response.ok) throw await errorOf(response);
    const body = (await response.json()) as Json;
    const rows = Array.isArray(body.results) ? body.results as Json[] : [];

    grants.push(...rows.map(toGrant));
    if (rows.length < 100 || grants.length >= Number(body.count)) return grants;
  }
}

export async function revokeGrant(config: DiditAuthConfig, accessToken: string, grantId: string): Promise<void> {
  const response = await call(config, `grants/${encodeURIComponent(grantId)}/`, {
    method: "DELETE",
    headers: bearer(accessToken)
  });

  if (!response.ok) throw await errorOf(response);
}

export interface StepUpRequest {
  action: unknown;
  amount?: unknown;
  currency?: unknown;
  /** The registered address Didit sends the person back to once they pass the check. */
  returnTo: string;
}

export interface StepUpStart {
  stepUp: StepUpResult;
  /** The identity check to send the person to, when a rule asked for one. */
  verificationUrl: string | null;
}

/** Asks Didit whether an action needs a step-up; opens the check when one of the application's rules applies. */
export async function requestStepUp(config: DiditAuthConfig, accessToken: string, request: StepUpRequest): Promise<StepUpStart> {
  const response = await call(config, "step-up/", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(accessToken) },
    body: JSON.stringify({ action: request.action, amount: request.amount, currency: request.currency, return_to: request.returnTo })
  });

  if (!response.ok) throw await errorOf(response);
  const body = (await response.json()) as Json;

  return { stepUp: toStepUp(body), verificationUrl: body.required === true ? text(body.verification_url) : null };
}

/** Didit's record of a step-up the session asked for. */
export async function readStepUp(config: DiditAuthConfig, accessToken: string, id: string): Promise<StepUpResult> {
  const response = await call(config, `step-up/${encodeURIComponent(id)}/`, { headers: bearer(accessToken) });

  if (!response.ok) throw await errorOf(response);
  return toStepUp((await response.json()) as Json);
}
