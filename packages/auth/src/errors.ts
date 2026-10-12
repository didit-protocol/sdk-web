/**
 * Error codes the SDK can report. Codes that come from the Didit API are passed
 * through unchanged, so the list is open: compare against the documented ones.
 *
 * - "invalid_credentials": wrong email or password, or a locked account
 * - "invalid_grant": a wrong, expired or already used code, link or challenge
 * - "method_unavailable": the method is turned off for this application
 * - "password_policy": the new password does not meet the application's policy
 * - "rate_limited": too many attempts; `retryAfter` holds the wait in seconds
 * - "mfa_required": the session needs a second factor before it can be used
 * - "reauthentication_required": the action needs a session that is at most
 *   five minutes old; call `stepUp()` and retry
 * - "passkey_required": the action needs a session created with a passkey;
 *   call `stepUp({ method: "passkey" })` and retry
 * - "passkey_unavailable": passkeys cannot run on this page's origin or browser
 * - "passkey_cancelled": the person dismissed the passkey prompt
 * - "not_signed_in": the action needs a signed-in person
 * - "no_pending_attempt": a code was submitted without starting that step first
 * - "invalid_state": the redirect does not belong to a sign-in this browser started
 * - "step_up_user_mismatch": a different person completed the step-up
 * - "invalid_publishable_key": the publishable key is malformed
 * - "invalid_token" / "token_expired": the token was rejected
 * - "jwks_unavailable": the issuer's signing keys could not be loaded
 * - "network_error": the request did not reach the Didit API
 */
export type DiditAuthErrorCode =
  | "invalid_credentials"
  | "invalid_grant"
  | "invalid_request"
  | "method_unavailable"
  | "password_policy"
  | "rate_limited"
  | "mfa_required"
  | "reauthentication_required"
  | "passkey_required"
  | "passkey_unavailable"
  | "passkey_cancelled"
  | "credential_exists"
  | "origin_not_allowed"
  | "invalid_redirect_uri"
  | "delivery_unavailable"
  | "not_signed_in"
  | "no_pending_attempt"
  | "invalid_state"
  | "step_up_user_mismatch"
  | "invalid_publishable_key"
  | "invalid_token"
  | "token_expired"
  | "jwks_unavailable"
  | "network_error"
  | "server_error"
  | (string & {});

export interface DiditAuthErrorOptions {
  status?: number;
  fields?: Record<string, string[]>;
  retryAfter?: number;
}

export class DiditAuthError extends Error {
  public readonly code: DiditAuthErrorCode;
  public readonly status?: number;
  public readonly fields?: Record<string, string[]>;
  public readonly retryAfter?: number;

  constructor(code: DiditAuthErrorCode, message?: string, options: DiditAuthErrorOptions = {}) {
    super(message || code);
    this.name = "DiditAuthError";
    this.code = code;
    this.status = options.status;
    this.fields = options.fields;
    this.retryAfter = options.retryAfter;
  }
}
