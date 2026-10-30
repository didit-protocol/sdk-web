import type { DiditEventError } from "./events";

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

/** The ten event categories the Didit events API accepts. */
export type DiditEventCategory =
  | "auth"
  | "session"
  | "gameplay"
  | "bonus"
  | "affiliate"
  | "payment"
  | "dispute"
  | "security"
  | "responsible_gambling"
  | "custom";

/**
 * One end-user event, e.g. a sign-up, a login or a failed login.
 *
 * The person the event belongs to is never part of the event: Didit takes it
 * from the monitoring token your backend minted for that person, so a tampered
 * browser cannot write events for somebody else. IP address, user agent and
 * the device fingerprint are added by the SDK and the server.
 */
export interface DiditEvent {
  /** Event category, e.g. "auth" for sign-up, login and logout. */
  category: DiditEventCategory;
  /** What happened within the category, e.g. "signup", "login", "login_failed", "logout". */
  actionType: string;
  /**
   * Your idempotency key for the event (at most 128 characters). The SDK
   * generates a random UUID when omitted. Sending the same id twice with the
   * same content is a harmless replay; with different content it is rejected.
   */
  eventId?: string;
  /** When it happened. An invalid Date is refused with a "validation" error. @default the time submitEvent was called */
  occurredAt?: Date | string;
  /** IANA time zone of the end user. @default the browser's time zone */
  timeZone?: string;
  /** Category-specific keys, e.g. payment_reference_id, amount, currency, payment_method and status for payments. */
  payload?: Record<string, unknown>;
  /** Scalar values your rules can address. */
  customValues?: Record<string, string | number | boolean | null>;
  session?: {
    sessionId?: string;
    sequence?: number;
    pageUrl?: string;
    referrer?: string;
  };
  transactionContext?: {
    amount?: string | number;
    currency?: string;
    direction?: string;
    paymentReferenceId?: string;
  };
  /** Profile hints about the person; their identity always comes from the monitoring token. */
  subject?: {
    fullName?: string;
    email?: string;
    phone?: string;
    country?: string;
  };
  /** The business the event belongs to, when it is a business account. */
  business?: Record<string, unknown>;
}

export interface SubmitEventOptions {
  /**
   * Short-lived monitoring token minted by your backend with
   * POST /v3/events/sdk-token/ for the signed-in person. Never ship an API key.
   */
  monitoringToken: string;
  event: DiditEvent;
  /** Didit verification API base URL. @default the configured baseUrl, else "https://verification.didit.me" */
  baseUrl?: string;
}

/** Queue settings for submitEvent. Every field is optional. */
export interface DiditEventsConfiguration {
  /** Didit verification API base URL. @default "https://verification.didit.me" */
  baseUrl?: string;
  /** Send as soon as this many events are waiting (1 to 500). @default 25 */
  batchSize?: number;
  /** Send waiting events after this many milliseconds. @default 5000 */
  flushIntervalMs?: number;
  /**
   * Events held in memory while they wait to be sent. When it is full, page
   * views and other low-value events are dropped first; security, payment,
   * dispute, responsible-gambling and bet events are never dropped.
   * @default 1000
   */
  maxQueueSize?: number;
  /** Called for every event Didit refused and every event the SDK had to drop. */
  onError?: (error: DiditEventError) => void;
}

/**
 * Why events were not stored:
 * - "invalid_token": the monitoring token is missing, unknown, revoked, used up or bound to another origin
 * - "expired_token": the monitoring token's lifetime has elapsed
 * - "monitoring_disabled": event monitoring is not turned on for the application
 * - "validation": the event failed validation; see errors for the per-field details
 * - "dropped": the queue was full and the event was dropped before it was sent
 * - "network": the request could not complete (only thrown by submitEvent when fetch is missing)
 */
export type DiditEventErrorType =
  | "invalid_token"
  | "expired_token"
  | "monitoring_disabled"
  | "validation"
  | "dropped"
  | "network";

/** What Didit did with one event. */
export interface DiditEventResult {
  eventId: string;
  /** "accepted" (stored), "replayed" (already stored with this id) or "rejected". */
  outcome: "accepted" | "replayed" | "rejected";
  /** Didit's id for the stored event. */
  eventUuid?: string;
  /** Review status Didit assigned to the event. */
  status?: string;
  /** Risk score from the rules that ran. */
  score?: number | null;
  /** Why the event was rejected. */
  error?: DiditEventError;
}

/** Outcome of one flush: every event Didit answered for, plus how many are still waiting. */
export interface DiditEventFlushResult {
  acceptedCount: number;
  replayedCount: number;
  rejectedCount: number;
  /** Events still queued, e.g. after a network error; they are retried automatically. */
  pendingCount: number;
  results: DiditEventResult[];
}
