import type {
  DiditEvent,
  DiditEventErrorType,
  DiditEventFlushResult,
  DiditEventResult,
  DeviceFingerprintPayload,
  DiditEventsConfiguration,
  SubmitEventOptions
} from "./types";

import { buildFingerprintHeaders, getDeviceFingerprintPayload, randomBase64Url } from "./fingerprint";

export const DEFAULT_EVENTS_BASE_URL = "https://verification.didit.me";

const BATCH_PATH = "/v1/events/batch/";
const MAX_BATCH_EVENTS = 500;
const MAX_RETRY_DELAY_MS = 60000;
// Browsers cap the bodies of every keepalive request a page has in flight at
// 64 KiB together; the allowance covers the envelope and the fingerprint.
const KEEPALIVE_BUDGET_BYTES = 64 * 1024;

// The server's backpressure contract (monitoring_event_schemas.py): these are
// never dropped, and the low-value ones go first when the queue is full.
const NEVER_DROPPED = /^(security|payment|dispute|responsible_gambling)\.|^gameplay\.(bet_placed|bet_settled|p2p_settlement)$/;
const LOW_VALUE =
  /^session\.(page_view|sdk_heartbeat|sdk_loaded|device_seen|bot_signal_observed)$|^bonus\.promotion_viewed$|^affiliate\.referral_clicked$/;

const PRIORITY_NEVER_DROPPED = 2;

/**
 * Typed error for events Didit refused or the SDK had to drop. Thrown by
 * submitEvent for a missing token or event, otherwise delivered to the
 * configured onError and in the flush results.
 */
export class DiditEventError extends Error {
  public readonly type: DiditEventErrorType;
  public readonly status?: number;
  public readonly eventIds: string[];
  public readonly errors?: unknown;

  constructor(
    type: DiditEventErrorType,
    message: string,
    options?: { status?: number; eventIds?: string[]; errors?: unknown }
  ) {
    super(message);
    this.name = "DiditEventError";
    this.type = type;
    this.status = options?.status;
    this.eventIds = options?.eventIds ?? [];
    this.errors = options?.errors;
  }
}

interface QueuedEvent {
  id: string;
  /** The event as sent, serialized once so a retry is byte-identical (a replay, never a conflict). */
  json: string;
  bytes: number;
  token: string;
  url: string;
  priority: number;
  sending: boolean;
}

interface Settings {
  baseUrl: string;
  batchSize: number;
  flushIntervalMs: number;
  maxQueueSize: number;
  onError?: (error: DiditEventError) => void;
}

const DEFAULT_SETTINGS: Settings = {
  baseUrl: DEFAULT_EVENTS_BASE_URL,
  batchSize: 25,
  flushIntervalMs: 5000,
  maxQueueSize: 1000
};

let settings: Settings = { ...DEFAULT_SETTINGS };
let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let failures = 0;
let flushing = 0;
let chain: Promise<unknown> = Promise.resolve();
let listening = false;
let exiting = false;
let keepaliveBytes = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compact(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function newEventId(): string {
  // randomUUID only exists in secure contexts; plain-http pages get 128 random bits instead.
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : randomBase64Url(16);
}

/** Maps the SDK-friendly camelCase event onto the snake_case wire contract of /v1/events/. */
export function buildEventRequestBody(event: DiditEvent, eventId: string): Record<string, unknown> {
  const { session, transactionContext, subject, occurredAt } = event;
  return compact({
    event_id: eventId,
    event_category: event.category,
    action_type: event.actionType,
    occurred_at: occurredAt instanceof Date ? occurredAt.toISOString() : occurredAt ?? new Date().toISOString(),
    time_zone: event.timeZone ?? browserTimeZone(),
    subject:
      subject &&
      compact({ full_name: subject.fullName, email: subject.email, phone: subject.phone, country: subject.country }),
    business: event.business,
    session:
      session &&
      compact({
        session_id: session.sessionId,
        sequence: session.sequence,
        page_url: session.pageUrl,
        referrer: session.referrer
      }),
    transaction_context:
      transactionContext &&
      compact({
        amount: transactionContext.amount,
        currency: transactionContext.currency,
        direction: transactionContext.direction,
        payment_reference_id: transactionContext.paymentReferenceId
      }),
    payload: event.payload,
    custom_values: event.customValues
  });
}

function report(error: DiditEventError): void {
  try {
    settings.onError?.(error);
  } catch {
    // An integrator callback must never break delivery of the other events.
  }
}

function waiting(): QueuedEvent[] {
  return queue.filter((entry) => !entry.sending);
}

function schedule(delayMs: number): void {
  if (timer !== undefined) return;
  timer = setTimeout(() => {
    timer = undefined;
    flush().catch(() => undefined);
  }, delayMs);
}

function clearTimer(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}

function scheduleWaiting(): void {
  if (flushing || !waiting().length) return;
  schedule(failures ? Math.min(Math.max(1000, settings.flushIntervalMs) * 2 ** failures, MAX_RETRY_DELAY_MS) : settings.flushIntervalMs);
}

function enqueue(entry: QueuedEvent): void {
  let victim: QueuedEvent | undefined;
  if (queue.length >= settings.maxQueueSize) {
    // The oldest waiting event of the lowest priority goes, or the new one when it ranks lower still.
    for (const queued of waiting()) {
      if (!victim || queued.priority < victim.priority) victim = queued;
    }
    if (!victim || entry.priority < victim.priority) victim = entry;
    if (victim.priority === PRIORITY_NEVER_DROPPED) victim = undefined;
  }
  if (victim && victim !== entry) queue.splice(queue.indexOf(victim), 1);
  if (victim !== entry) queue.push(entry);
  if (victim) {
    report(
      new DiditEventError("dropped", "The event queue is full, so the event was dropped before it was sent.", {
        eventIds: [victim.id]
      })
    );
  }
}

/** The next waiting events that share a token and endpoint, oldest first, within an optional byte budget. */
function nextBatch(budgetBytes = Infinity, envelopeBytes = 0): QueuedEvent[] {
  const batch: QueuedEvent[] = [];
  let bytes = envelopeBytes;
  for (const entry of queue) {
    if (batch.length === settings.batchSize) break;
    if (entry.sending || bytes + entry.bytes + (batch.length ? 1 : 0) > budgetBytes) continue;
    if (batch.length && (entry.token !== batch[0].token || entry.url !== batch[0].url)) continue;
    bytes += entry.bytes + (batch.length ? 1 : 0);
    batch.push(entry);
  }
  return batch;
}

function readDetail(body: unknown): string | undefined {
  return isRecord(body) && typeof body.detail === "string" ? body.detail : undefined;
}

/** Classifies a refused batch: every event in it shares the outcome. */
export function classifyEventError(status: number, body: unknown, eventIds: string[]): DiditEventError {
  const detail = readDetail(body);
  const code = isRecord(body) && typeof body.code === "string" ? body.code : "";
  let type: DiditEventErrorType = "validation";
  if (code === "event_monitoring_disabled") {
    type = "monitoring_disabled";
  } else if (status === 401 || status === 403) {
    type = /expired/i.test(`${detail} ${code}`) ? "expired_token" : "invalid_token";
  }
  return new DiditEventError(type, detail ?? `Didit refused the events with status ${status}.`, {
    status,
    eventIds,
    errors: type === "validation" && isRecord(body) ? body : undefined
  });
}

function isTransient(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Sends one batch and settles its events. Returns false when the batch has to
 * be retried (network error, timeout, rate limit, 5xx, unreadable answer): the
 * events stay queued with the same ids, so a batch the server already stored
 * comes back as "replayed" instead of being stored twice.
 */
function byteLength(json: string): number {
  return encodeURIComponent(json).replace(/%[\dA-F]{2}/g, "-").length;
}

function batchBody(batch: QueuedEvent[], fingerprint: DeviceFingerprintPayload | null): string {
  const fingerprintJson = fingerprint ? `,"fingerprint_v2":${JSON.stringify(fingerprint)}` : "";

  return `{"events":[${batch.map((entry) => entry.json).join(",")}]${fingerprintJson}}`;
}

async function send(
  batch: QueuedEvent[], result: DiditEventFlushResult, fingerprint: DeviceFingerprintPayload | null, keepalive = false
): Promise<boolean> {
  const bodyJson = batchBody(batch, fingerprint);
  const reservedBytes = keepalive ? byteLength(bodyJson) : 0;
  const settled = new Set<QueuedEvent>();
  const errors: DiditEventError[] = [];
  const reject = (entry: QueuedEvent, error: DiditEventError): void => {
    result.results.push({ eventId: entry.id, outcome: "rejected", error });
    result.rejectedCount++;
    settled.add(entry);
  };
  for (const entry of batch) entry.sending = true;
  keepaliveBytes += reservedBytes;
  try {
    const response = await fetch(batch[0].url, {
      method: "POST",
      keepalive,
      headers: {
        "Content-Type": "application/json",
        "X-Monitoring-Token": batch[0].token,
        ...buildFingerprintHeaders(fingerprint)
      },
      body: bodyJson
    });
    const body = await readJson(response);
    if (isTransient(response.status)) return false;

    if (!response.ok) {
      const error = classifyEventError(
        response.status,
        body,
        batch.map((entry) => entry.id)
      );
      for (const entry of batch) reject(entry, error);
      errors.push(error);
      return true;
    }

    const answers = isRecord(body) && Array.isArray(body.results) ? body.results : [];
    batch.forEach((entry, index) => {
      const matches = answers.filter((item) => isRecord(item) && item.index === index);
      const answer = matches[0];

      if (matches.length !== 1 || !isRecord(answer)) return;
      if (answer.outcome === "accepted" || answer.outcome === "replayed") {
        const eventResult: DiditEventResult = { eventId: entry.id, outcome: answer.outcome };
        if (typeof answer.event_uuid === "string") eventResult.eventUuid = answer.event_uuid;
        if (typeof answer.status === "string") eventResult.status = answer.status;
        if (typeof answer.score === "number" || answer.score === null) eventResult.score = answer.score;
        result.results.push(eventResult);
        result[answer.outcome === "accepted" ? "acceptedCount" : "replayedCount"]++;
        settled.add(entry);
      } else if (answer.outcome === "rejected" && isRecord(answer.errors)) {
        const error = new DiditEventError("validation", "Didit rejected the event; see errors for the details.", {
          status: response.status,
          eventIds: [entry.id],
          errors: answer.errors
        });
        reject(entry, error);
        errors.push(error);
      }
    });
    // An answer that does not cover every event is retried like a network error.
    return settled.size === batch.length;
  } catch {
    return false;
  } finally {
    keepaliveBytes -= reservedBytes;
    queue = queue.filter((entry) => !settled.has(entry));
    for (const entry of batch) entry.sending = false;
    failures = settled.size === batch.length ? 0 : failures + 1;
    if (keepalive) scheduleWaiting();
    errors.forEach(report);
  }
}

function emptyResult(): DiditEventFlushResult {
  return { acceptedCount: 0, replayedCount: 0, rejectedCount: 0, pendingCount: 0, results: [] };
}

async function drain(): Promise<DiditEventFlushResult> {
  const result = emptyResult();
  const fingerprint = await getDeviceFingerprintPayload().catch(() => null);

  clearTimer();
  let batch: QueuedEvent[];
  while ((batch = nextBatch()).length) {
    if (!(await send(batch, result, fingerprint))) break;
  }
  result.pendingCount = queue.length;
  return result;
}

/**
 * Sends what is still waiting while the page is being hidden or unloaded.
 *
 * sendBeacon cannot carry the X-Monitoring-Token header the events lane reads
 * the credential from, so this uses fetch with keepalive, the same browser
 * mechanism (the request outlives the page, within a 64 KiB budget) with
 * headers. The batches go out in parallel: there is no time left to wait for
 * one answer before sending the next.
 */
async function drainOnExit(): Promise<void> {
  if (exiting) return;
  exiting = true;
  clearTimer();
  try {
    const fingerprint = await getDeviceFingerprintPayload().catch(() => null);
    const envelopeBytes = byteLength(batchBody([], fingerprint));
    let batch: QueuedEvent[];

    while ((batch = nextBatch(KEEPALIVE_BUDGET_BYTES - keepaliveBytes, envelopeBytes)).length) {
      send(batch, emptyResult(), fingerprint, true).catch(() => undefined);
    }
  } finally {
    exiting = false;
    // What did not fit goes out on the normal timer if the page comes back.
    scheduleWaiting();
  }
}

function sendOnExit(): void {
  drainOnExit().catch(() => undefined);
}

function onVisibilityChange(): void {
  if (document.visibilityState === "hidden") sendOnExit();
}

function listen(): void {
  if (listening || typeof window === "undefined" || typeof document === "undefined") return;
  listening = true;
  window.addEventListener("pagehide", sendOnExit);
  document.addEventListener("visibilitychange", onVisibilityChange);
}

/**
 * Tunes the event queue. Call it once, before or after the first submitEvent;
 * fields you leave out keep their current value.
 */
export function configureEvents(configuration: DiditEventsConfiguration): void {
  const next = { ...settings, ...compact({ ...configuration }) } as Settings;
  next.baseUrl = next.baseUrl.replace(/\/+$/, "");
  next.batchSize = Math.min(Math.max(1, Math.floor(next.batchSize)), MAX_BATCH_EVENTS);
  next.flushIntervalMs = Math.max(0, next.flushIntervalMs);
  next.maxQueueSize = Math.max(1, Math.floor(next.maxQueueSize));
  settings = next;
}

/**
 * Queues an end-user event for Didit's event monitoring and returns its id.
 *
 * Events are sent in batches to POST /v1/events/batch/ with the
 * X-Monitoring-Token header: as soon as `batchSize` events are waiting, after
 * `flushIntervalMs`, and when the page is hidden or closed. The device
 * fingerprint is attached to every batch. Each event keeps the token it was
 * submitted with, so events from before and after a sign-in never mix people.
 *
 * @throws {DiditEventError} "invalid_token" without a monitoringToken,
 * "validation" without an event category and action type, "network" when the
 * environment has no fetch.
 */
export function submitEvent(options: SubmitEventOptions): string {
  const token = options?.monitoringToken;
  const event = options?.event;
  if (!token || typeof token !== "string") {
    throw new DiditEventError("invalid_token", "monitoringToken is required.");
  }
  if (!isRecord(event) || !event.category || typeof event.actionType !== "string" || !event.actionType.trim()) {
    throw new DiditEventError("validation", "event.category and event.actionType are required.");
  }
  if (typeof fetch !== "function") {
    throw new DiditEventError("network", "fetch is not available in this environment.");
  }

  const eventId = event.eventId || newEventId();
  const json = JSON.stringify(buildEventRequestBody(event, eventId));
  const kind = `${event.category}.${event.actionType}`;
  enqueue({
    id: eventId,
    json,
    // UTF-8 length; JSON.stringify never leaves a lone surrogate for encodeURIComponent to reject.
    bytes: byteLength(json),
    token,
    url: `${(options.baseUrl ?? settings.baseUrl).replace(/\/+$/, "")}${BATCH_PATH}`,
    priority: NEVER_DROPPED.test(kind) ? PRIORITY_NEVER_DROPPED : LOW_VALUE.test(kind) ? 0 : 1,
    sending: false
  });

  listen();
  // Collected now so the batch sent while the page closes does not have to wait for it.
  getDeviceFingerprintPayload().catch(() => null);
  if (!flushing && !failures && waiting().length >= settings.batchSize) {
    flush().catch(() => undefined);
  } else {
    scheduleWaiting();
  }
  return eventId;
}

/**
 * Sends every waiting event now. Resolves with what Didit did with each event
 * once the queue is empty, or with `pendingCount` above zero when the network
 * failed (those events are retried automatically). Never rejects.
 */
export function flush(): Promise<DiditEventFlushResult> {
  flushing++;
  const run = chain
    .then(drain)
    .catch(() => ({ ...emptyResult(), pendingCount: queue.length }))
    .finally(() => {
      flushing--;
      scheduleWaiting();
    });
  chain = run;
  return run;
}

export function resetEventsForTesting(): void {
  clearTimer();
  if (listening) {
    window.removeEventListener("pagehide", sendOnExit);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }
  settings = { ...DEFAULT_SETTINGS };
  queue = [];
  failures = 0;
  flushing = 0;
  chain = Promise.resolve();
  listening = false;
  exiting = false;
  keepaliveBytes = 0;
}
