export type DiditSdkState = "idle" | "loading" | "ready" | "error";

export type VerificationStatus = "Approved" | "Pending" | "Declined";

export interface SessionData {
  sessionId: string;
  status: VerificationStatus;
}

export type VerificationErrorType = "sessionExpired" | "networkError" | "cameraAccessDenied" | "unknown";

export interface VerificationError {
  type: VerificationErrorType;
  message: string;
}

export type VerificationResultType = "completed" | "cancelled" | "failed";

export interface VerificationResult {
  type: VerificationResultType;
  session?: SessionData;
  error?: VerificationError;
}

/**
 * A physical camera on the end user's device. Mirrors the `CameraLens` option
 * of the native SDKs.
 */
export type CameraLens = "front" | "back";

export interface DiditSdkConfiguration {
  loggingEnabled?: boolean;
  containerElement?: HTMLElement;
  zIndex?: number;
  showCloseButton?: boolean;
  showExitConfirmation?: boolean;
  closeModalOnComplete?: boolean;
  embedded?: boolean;
  embeddedContainerId?: string;
  /**
   * The camera the document capture opens first. `"back"` (the default) is
   * the rear camera; `"front"` opens the selfie camera. A device without the
   * requested camera keeps the other one. Forwarded to the verification page
   * as the `document_camera` query parameter of the verification URL.
   * @default "back"
   */
  defaultDocumentCamera?: CameraLens;
  /**
   * The camera the face (liveness) capture opens first. `"front"` (the
   * default) is the selfie camera; `"back"` opens the rear camera, for a
   * kiosk or an operator pointing the device at the person being verified.
   * Applies to the passive liveness check; a device without a rear camera
   * keeps the front one. Forwarded to the verification page as the
   * `liveness_camera` query parameter of the verification URL.
   * @default "front"
   */
  defaultLivenessCamera?: CameraLens;
  /**
   * Show the in-capture camera switcher on the document step. Set `false` to
   * lock the user to `defaultDocumentCamera`. The switcher is hidden anyway
   * on a device with a single camera. Forwarded as the
   * `document_camera_switch` query parameter.
   * @default true
   */
  showDocumentCameraSwitchButton?: boolean;
  /**
   * Show the in-capture camera switcher on the face (liveness) step. Set
   * `false` to lock the user to `defaultLivenessCamera`. The switcher is
   * hidden anyway on a device with a single camera. Forwarded as the
   * `liveness_camera_switch` query parameter.
   * @default true
   */
  showLivenessCameraSwitchButton?: boolean;
}

export interface StartVerificationOptions {
  url: string;
  configuration?: DiditSdkConfiguration;
}

export type VerificationEventType =
  | "didit:ready"
  | "didit:started"
  | "didit:step_started"
  | "didit:step_completed"
  | "didit:media_started"
  | "didit:media_captured"
  | "didit:document_selected"
  | "didit:verification_submitted"
  | "didit:code_sent"
  | "didit:code_verified"
  | "didit:status_updated"
  | "didit:completed"
  | "didit:cancelled"
  | "didit:error"
  | "didit:step_changed"
  | "didit:close_request";

export interface VerificationEventData {
  sessionId?: string;
  status?: string;
  step?: string;
  nextStep?: string;
  previousStep?: string;
  error?: string;
  country?: string;
  documentType?: string;
  isAuto?: boolean;
  mediaType?: string;
  channel?: string;
  codeSize?: number;
  [key: string]: unknown;
}

export interface VerificationEvent {
  type: VerificationEventType;
  data?: VerificationEventData;
  timestamp?: number;
}

export type VerificationCallback = (result: VerificationResult) => void;

export type StateChangeCallback = (state: DiditSdkState, error?: string) => void;

export type EventCallback = (event: VerificationEvent) => void;

/**
 * Payment method attached to a transaction participant.
 */
export interface DiditTransactionPaymentMethod {
  /** Payment method kind, e.g. "card", "bank_account", "crypto", "unhosted_wallet". */
  type?: string;
  /** Account identifier: card fingerprint, IBAN, wallet address, etc. */
  accountId?: string;
  /** ISO country code of the issuing institution. */
  issuingCountry?: string;
}

/**
 * A transaction participant (subject or counterparty).
 */
export interface DiditTransactionParticipant {
  /** Entity type: "individual" (default) or "company". */
  type?: string;
  /** Your external user id (vendor data). For the subject it is enforced server-side from the transaction token. */
  externalUserId?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  /** Date of birth in YYYY-MM-DD format. */
  dob?: string;
  /** Free-form address object, e.g. { country: "US", city: "..." }. */
  address?: Record<string, unknown>;
  /** Institution details for company participants. */
  institutionInfo?: Record<string, unknown>;
  /** Optional explicit device context. Device intelligence is attached automatically by the SDK. */
  device?: Record<string, unknown>;
  paymentMethod?: DiditTransactionPaymentMethod;
}

/**
 * Monetary and routing details of the transaction.
 */
export interface DiditTransactionDetails {
  /** Direction of the transaction: "in" or "out". */
  direction: string;
  amount: number | string;
  /** Currency code, e.g. "USD" or "BTC". */
  currency: string;
  /** Currency kind: "fiat" or "crypto". */
  currencyType?: string;
  amountInDefaultCurrency?: number | string;
  defaultCurrencyCode?: string;
  /** Free-form payment description. */
  paymentDetails?: string;
  /** Payment reference id; the on-chain transaction hash for crypto transactions. */
  paymentTxnId?: string;
  /** Action type override; defaults to the transaction category. */
  actionType?: string;
  /** Crypto-specific parameters, e.g. { crypto_chain: "ETH" }. */
  cryptoParams?: Record<string, unknown>;
}

/**
 * Travel-rule details for travel-rule transactions.
 */
export interface DiditTravelRuleDetails {
  status: string;
  protocol?: string;
  required?: boolean;
  obligationsCount?: number;
  originatorData?: Record<string, unknown>;
  beneficiaryData?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * The camelCase transaction payload submitted to POST /v1/transactions/.
 */
export interface DiditTransactionPayload {
  /** Your unique transaction id. */
  txnId: string;
  /** Transaction timestamp as an ISO-8601 string. Defaults to now server-side. */
  txnDate?: string;
  /** IANA time zone id, e.g. "Europe/Madrid". */
  zoneId?: string;
  /** Transaction category, e.g. "finance", "kyc", "travelRule", "userPlatformEvent", "gamblingBet". */
  category: string;
  details: DiditTransactionDetails;
  subject: DiditTransactionParticipant;
  counterparty?: DiditTransactionParticipant;
  /** Custom key/value properties stored with the transaction. */
  customProperties?: Record<string, unknown>;
  travelRule?: DiditTravelRuleDetails;
  /** Force crypto AML screening on/off; defaults to the application monitoring settings. */
  includeCryptoScreening?: boolean;
}

/** Known action types: "verification_session" and "wallet_ownership". */
export type TransactionActionType = "verification_session" | "wallet_ownership";

/**
 * A user action required to complete the transaction, e.g. a biometric
 * verification session or a wallet-ownership confirmation widget.
 */
export interface TransactionActionRequired {
  /** "verification_session" or "wallet_ownership". */
  type: string;
  /** Hosted URL of the required action flow (didit.me origin). */
  url: string;
  /** Verification session id (verification_session actions). */
  sessionId?: string;
  /** Verification session token (verification_session actions). */
  sessionToken?: string;
  /** Verification session status (verification_session actions). */
  status?: string;
  /** Wallet-ownership widget session id (wallet_ownership actions). */
  widgetSessionId?: string;
  /** Widget expiration timestamp (wallet_ownership actions). */
  expiresAt?: string;
}

export interface SubmitTransactionResult {
  /** Didit transaction id (UUID). Use it to fetch the transaction later. */
  transactionId: string;
  /** Transaction review status, e.g. "APPROVED", "IN_REVIEW", "AWAITING_USER", "DECLINED". */
  status: string;
  /** Travel-rule exchange status when a travel-rule transfer was initiated. */
  travelRuleStatus?: string;
  /** Present when the end user must complete an additional action. */
  actionRequired?: TransactionActionRequired;
}

/**
 * Signal delivered alongside a stale/pre-action `result` when the
 * post-action refresh could not complete (e.g. the transaction token became
 * invalid or expired while the user was in the action flow). `type` mirrors
 * {@link TransactionErrorType}; terminal auth failures (`invalid_token`,
 * `expired_token`) are the only cases currently reported here.
 */
export interface TransactionActionCompletedError {
  type: TransactionErrorType;
  message: string;
}

/**
 * Called after an auto-launched `wallet_ownership` action flow completes or
 * its modal is closed. `result` is the refreshed transaction, or the original
 * pre-action result when the refresh could not complete - in which case
 * `error` is set so integrators can distinguish "refresh failed" from "the
 * action genuinely left the transaction unchanged". The `error` parameter
 * is additive: existing single-argument callbacks keep working unchanged.
 * Never invoked for a `verification_session` action, since that type is
 * never auto-launched.
 */
export type TransactionActionCompletedCallback = (
  result: SubmitTransactionResult,
  error?: TransactionActionCompletedError
) => void;

export interface SubmitTransactionOptions {
  /** Short-lived transaction token minted by your backend via POST /v3/transactions/sdk-token/. */
  transactionToken: string;
  /** Didit verification API base URL. @default "https://verification.didit.me" */
  baseUrl?: string;
  transaction: DiditTransactionPayload;
  /**
   * Automatically open the verification modal when the response contains a
   * `wallet_ownership` actionRequired block. Has no effect on a
   * `verification_session` action, which is never auto-launched and is
   * always returned in the result's `actionRequired` for the host to launch
   * with its own verification integration.
   * @default true
   */
  autoLaunchAction?: boolean;
  /**
   * Called with the refreshed transaction after an auto-launched
   * `wallet_ownership` action flow completes or its modal is closed. Not
   * invoked for `verification_session` actions, since those are never
   * auto-launched.
   */
  onActionCompleted?: TransactionActionCompletedCallback;
}

/** Typed error categories thrown by submitTransaction. */
export type TransactionErrorType = "invalid_token" | "expired_token" | "validation" | "network";

/** Navigator-derived signals collected for the didit-fp-v2 device fingerprint. */
export interface DeviceFingerprintNavigatorSignals {
  userAgent: string;
  platform: string | null;
  language: string;
  languages: string[];
  hardwareConcurrency: number | null;
  deviceMemory: number | null;
  maxTouchPoints: number | null;
  devicePixelRatio: number | null;
  screenWidth: number | null;
  screenHeight: number | null;
  colorDepth: number | null;
  timeZone: string | null;
  uaDataPlatform: string | null;
  uaDataMobile: boolean | null;
  uaDataBrands: string[];
}

export interface DeviceFingerprintSignals {
  platform: "web";
  navigator: DeviceFingerprintNavigatorSignals;
  webview: { kind: string };
}

/** The didit-fp-v2 device fingerprint payload sent as the `fingerprint_v2` body field. */
export interface DeviceFingerprintPayload {
  version: 2;
  schema: "didit-fp-v2";
  platform: "web";
  collectedAt: string;
  persistentId: string;
  persistentIdSources: string[];
  persistentIdWasCreated: boolean;
  signals: DeviceFingerprintSignals;
  bot: { score: number; flags: string[] };
  compositeHash: string;
}
