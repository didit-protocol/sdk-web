import type {
  DiditTransactionDetails,
  DiditTransactionParticipant,
  DiditTransactionPayload,
  DiditTravelRuleDetails,
  SubmitTransactionResult,
  TransactionActionRequired,
  TransactionErrorType
} from "./types";

import { buildFingerprintHeaders, getDeviceFingerprintPayload } from "./fingerprint";

export const DEFAULT_TRANSACTION_BASE_URL = "https://verification.didit.me";

const ACTION_POLL_INTERVAL_MS = 1500;
const ACTION_POLL_MAX_ATTEMPTS = 10;

const TRANSACTION_ERROR_MESSAGES: Record<TransactionErrorType, string> = {
  invalid_token: "The transaction token is invalid.",
  expired_token: "The transaction token has expired.",
  validation: "The transaction payload failed validation.",
  network: "A network error occurred while contacting the Didit API."
};

/**
 * Typed error thrown by DiditSdk.submitTransaction.
 *
 * - "invalid_token": the X-Transaction-Token was rejected (missing, revoked, over max uses)
 * - "expired_token": the transaction token TTL has elapsed
 * - "validation": the payload failed validation; see fieldErrors for per-field details
 * - "network": the request could not complete or the API returned an unexpected error
 */
export class DiditTransactionError extends Error {
  public readonly type: TransactionErrorType;
  public readonly status?: number;
  public readonly fieldErrors?: Record<string, unknown>;

  constructor(
    type: TransactionErrorType,
    message?: string,
    options?: { status?: number; fieldErrors?: Record<string, unknown> }
  ) {
    super(message || TRANSACTION_ERROR_MESSAGES[type]);
    this.name = "DiditTransactionError";
    this.type = type;
    this.status = options?.status;
    this.fieldErrors = options?.fieldErrors;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compact(record: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function mapDetails(details: DiditTransactionDetails): Record<string, unknown> {
  return compact({
    direction: details.direction,
    amount: details.amount,
    currency: details.currency,
    currencyType: details.currencyType,
    amountInDefaultCurrency: details.amountInDefaultCurrency,
    defaultCurrencyCode: details.defaultCurrencyCode,
    paymentDetails: details.paymentDetails,
    paymentTxnId: details.paymentTxnId,
    type: details.actionType,
    cryptoParams: details.cryptoParams
  });
}

function mapParticipant(participant: DiditTransactionParticipant | undefined): Record<string, unknown> | undefined {
  if (!participant) return undefined;
  return compact({
    type: participant.type,
    externalUserId: participant.externalUserId,
    fullName: participant.fullName,
    firstName: participant.firstName,
    lastName: participant.lastName,
    dob: participant.dob,
    address: participant.address,
    institutionInfo: participant.institutionInfo,
    device: participant.device,
    paymentMethod: participant.paymentMethod
      ? compact({
          type: participant.paymentMethod.type,
          accountId: participant.paymentMethod.accountId,
          issuingCountry: participant.paymentMethod.issuingCountry
        })
      : undefined
  });
}

function mapTravelRule(travelRule: DiditTravelRuleDetails | undefined): Record<string, unknown> | undefined {
  if (!travelRule) return undefined;
  return compact({
    status: travelRule.status,
    protocol: travelRule.protocol,
    required: travelRule.required,
    obligationsCount: travelRule.obligationsCount,
    originatorData: travelRule.originatorData,
    beneficiaryData: travelRule.beneficiaryData,
    metadata: travelRule.metadata
  });
}

/**
 * Maps the SDK-friendly camelCase payload onto the wire aliases accepted by the
 * Didit transactions API (txnId, txnDate, zoneId, type, info, subject,
 * counterparty, props, travelRule, includeCryptoScreening).
 */
export function buildTransactionRequestBody(transaction: DiditTransactionPayload): Record<string, unknown> {
  return compact({
    txnId: transaction.txnId,
    txnDate: transaction.txnDate,
    zoneId: transaction.zoneId,
    type: transaction.category,
    info: mapDetails(transaction.details),
    subject: mapParticipant(transaction.subject),
    counterparty: mapParticipant(transaction.counterparty),
    props: transaction.customProperties,
    travelRule: mapTravelRule(transaction.travelRule),
    includeCryptoScreening: transaction.includeCryptoScreening
  });
}

function pickString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

function mapActionRequired(raw: unknown): TransactionActionRequired | undefined {
  if (!isPlainRecord(raw)) return undefined;
  const type = pickString(raw, "type");
  const url = pickString(raw, "url");
  if (!type || !url) return undefined;
  const action: TransactionActionRequired = { type, url };
  const sessionId = pickString(raw, "session_id", "sessionId");
  if (sessionId) action.sessionId = sessionId;
  const sessionToken = pickString(raw, "session_token", "sessionToken");
  if (sessionToken) action.sessionToken = sessionToken;
  const status = pickString(raw, "status");
  if (status) action.status = status;
  const widgetSessionId = pickString(raw, "widget_session_id", "widgetSessionId");
  if (widgetSessionId) action.widgetSessionId = widgetSessionId;
  const expiresAt = pickString(raw, "expires_at", "expiresAt");
  if (expiresAt) action.expiresAt = expiresAt;
  return action;
}

function mapTravelRuleStatus(raw: Record<string, unknown>): string | undefined {
  const travelRule = raw.travel_rule ?? raw.travelRule;
  if (isPlainRecord(travelRule)) {
    const status = pickString(travelRule, "status");
    if (status) return status;
  }
  const props = raw.props;
  if (isPlainRecord(props)) {
    const status = pickString(props, "travel_rule_status", "travelRuleStatus");
    if (status) return status;
  }
  return pickString(raw, "travel_rule_status", "travelRuleStatus");
}

export function mapTransactionResponse(raw: Record<string, unknown>): SubmitTransactionResult {
  const transactionId = pickString(raw, "uuid", "transaction_id", "transactionId");
  const status = pickString(raw, "status");
  if (!transactionId || !status) {
    // A missing id/status is not a valid transaction snapshot: fabricating
    // empty strings here would let a malformed response (envelope,
    // intercepting proxy, contract drift) look like a real result to
    // callers - e.g. the poll's statusMoved early-exit would trigger on an
    // empty status that merely differs from a real initialStatus.
    throw new DiditTransactionError(
      "network",
      "Unexpected response shape from the Didit API: missing transaction id or status."
    );
  }
  const result: SubmitTransactionResult = { transactionId, status };
  const travelRuleStatus = mapTravelRuleStatus(raw);
  if (travelRuleStatus) result.travelRuleStatus = travelRuleStatus;
  const actionRequired = mapActionRequired(raw.action_required ?? raw.actionRequired);
  if (actionRequired) result.actionRequired = actionRequired;
  return result;
}

function extractDetailMessage(body: unknown): string | undefined {
  if (!isPlainRecord(body)) return undefined;
  return pickString(body, "detail", "message", "error");
}

export function classifyTransactionError(status: number, body: unknown): DiditTransactionError {
  const detail = extractDetailMessage(body);
  if (status === 401 || status === 403) {
    const serialized = `${detail ?? ""} ${pickString(isPlainRecord(body) ? body : {}, "code") ?? ""}`;
    if (/expired/i.test(serialized)) {
      return new DiditTransactionError("expired_token", detail, { status });
    }
    return new DiditTransactionError("invalid_token", detail, { status });
  }
  if (status === 400 || status === 422) {
    return new DiditTransactionError("validation", detail, {
      status,
      fieldErrors: isPlainRecord(body) ? body : undefined
    });
  }
  return new DiditTransactionError("network", `Request failed with status ${status}.`, { status });
}

async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function performRequest(url: string, init: RequestInit): Promise<SubmitTransactionResult> {
  if (typeof fetch !== "function") {
    throw new DiditTransactionError("network", "fetch is not available in this environment.");
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new DiditTransactionError("network");
  }

  const body = await readJsonBody(response);
  if (!response.ok) {
    throw classifyTransactionError(response.status, body);
  }
  if (!isPlainRecord(body)) {
    throw new DiditTransactionError("network", "Unexpected empty response from the Didit API.", {
      status: response.status
    });
  }
  return mapTransactionResponse(body);
}

export interface TransactionRequestArgs {
  baseUrl: string;
  transactionToken: string;
}

export async function submitTransactionRequest(
  args: TransactionRequestArgs & { transaction: DiditTransactionPayload }
): Promise<SubmitTransactionResult> {
  const fingerprint = await getDeviceFingerprintPayload().catch(() => null);
  const body = buildTransactionRequestBody(args.transaction);
  if (fingerprint) {
    body.fingerprint_v2 = fingerprint;
  }
  return performRequest(`${args.baseUrl}/v1/transactions/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Transaction-Token": args.transactionToken,
      ...buildFingerprintHeaders(fingerprint)
    },
    body: JSON.stringify(body)
  });
}

export async function fetchTransaction(
  args: TransactionRequestArgs & { transactionId: string }
): Promise<SubmitTransactionResult> {
  return performRequest(`${args.baseUrl}/v1/transactions/${args.transactionId}/`, {
    method: "GET",
    headers: { "X-Transaction-Token": args.transactionToken }
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Terminal auth failures that will never succeed on retry: keep polling would just burn the token's remaining uses. */
function isTerminalPollError(error: unknown): error is DiditTransactionError {
  return error instanceof DiditTransactionError && (error.type === "invalid_token" || error.type === "expired_token");
}

/**
 * Re-fetches the transaction after an action flow finished or its modal was
 * closed. Polls with a bounded retry (never relies on a single event/attempt)
 * and stops early once the required action is cleared or the status moved on.
 * Returns the latest successfully fetched result, or null when every attempt
 * failed.
 *
 * A terminal auth failure (invalid_token/expired_token - e.g. a maxUses
 * token exhausted by the poll's own GETs, or the token TTL elapsing while
 * the user was in the action flow) aborts immediately instead of retrying:
 * it can never succeed, and each attempt would otherwise still count
 * against the token's use_count server-side. The error is rethrown so the
 * caller can surface it instead of silently returning a stale result.
 *
 * `isAborted` is polled between attempts so a caller that tears down (e.g.
 * DiditSdk.destroy()) can stop the loop from making further network calls.
 */
export async function pollTransactionAfterAction(
  args: TransactionRequestArgs & {
    transactionId: string;
    initialStatus?: string;
    intervalMs?: number;
    maxAttempts?: number;
    isAborted?: () => boolean;
  }
): Promise<SubmitTransactionResult | null> {
  const intervalMs = args.intervalMs ?? ACTION_POLL_INTERVAL_MS;
  const maxAttempts = Math.max(1, args.maxAttempts ?? ACTION_POLL_MAX_ATTEMPTS);
  let latest: SubmitTransactionResult | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (args.isAborted?.()) return latest;
    if (attempt > 0) {
      await delay(intervalMs);
    }
    if (args.isAborted?.()) return latest;
    try {
      latest = await fetchTransaction(args);
      const actionResolved = !latest.actionRequired;
      const statusMoved = args.initialStatus !== undefined && latest.status !== args.initialStatus;
      if (actionResolved || statusMoved) {
        return latest;
      }
    } catch (error) {
      if (isTerminalPollError(error)) {
        throw error;
      }
      // Transient failure; keep polling until the bound is reached.
    }
  }
  return latest;
}
