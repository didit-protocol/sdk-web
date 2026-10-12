import type {
  DiditEvent,
  DiditEventErrorType,
  DiditEventFlushResult,
  DiditEventResult,
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
const KEEPALIVE_BUDGET_BYTES = 60000;
const REQUEST_ALLOWANCE_BYTES = 4096;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compact(record: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
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
    void flush();
  }, delayMs);
}

function clearTimer(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}

function scheduleWaiting(): void {
  if (flushing || !waiting().length) return;
  schedule(failures ? Math.min(settings.flushIntervalMs * 2 ** failures, MAX_RETRY_DELAY_MS) : settings.flushIntervalMs);
}

function enqueue(entry: QueuedEvent): void {
  if (queue.length >= settings.maxQueueSize) {
    // Oldest waiting event of the lowest priority, unless the new one ranks lower still.
    let victim: QueuedEvent = entry;
    for (const queued of waiting()) {
      if (queued.priority <= victim.priority && (victim === entry ? queued.priority <= entry.priority : false)) {
        victim = queued;
        break;
      }
    }
    for (const queued of waiting()) {
      if (queued.priority < victim.priority) victim = queued;
    }
    if (victim.priority < PRIORITY_NEVER_DROPPED) {
      if (victim !== entry) queue = queue.filter((queued) => queued !== victim);
      report(
        new DiditEventError("dropped", "The event queue is full, so the event was dropped before it was sent.", {
          eventIds: [victim.id]
        })
      );
      if (victim === entry) return;
    }
  }
  queue.push(entry);
}

/** The next waiting events that share a token and endpoint, oldest first, within an optional byte budget. */
function nextBatch(budgetBytes = Infinity): QueuedEvent[] {
  const batch: QueuedEvent[] = [];
  let bytes = REQUEST_ALLOWANCE_BYTES;
  for (const entry of queue) {
    if (batch.length === settings.batchSize) break;
    if (entry.sending || bytes + entry.bytes > budgetBytes) continue;
    if (batch.length && (entry.token !== batch[0].token || entry.url !== batch[0].url)) continue;
    bytes += entry.bytes;
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
async function send(batch: QueuedEvent[], result: DiditEventFlushResult, keepalive = false): Promise<boolean> {
  for (const entry of batch) entry.sending = true;
  const settled = new Set<QueuedEvent>();
  let delivered = false;
  try {
    const fingerprint = await getDeviceFingerprintPayload().catch(() => null);
    const fingerprintJson = fingerprint ? `,"fingerprint_v2":${JSON.stringify(fingerprint)}` : "";
    const response = await fetch(batch[0].url, {
      method: "POST",
      keepalive,
      headers: {
        "Content-Type": "application/json",
        "X-Monitoring-Token": batch[0].token,
        ...buildFingerprintHeaders(fingerprint)
      },
      body: `{"events":[${batch.map((entry) => entry.json).join(",")}]${fingerprintJson}}`
    });
    const body = await readJson(response);
    if (isTransient(response.status)) return false;

    if (!response.ok) {
      const error = classifyEventError(
        response.status,
        body,
        batch.map((entry) => entry.id)
      );
      for (const entry of batch) {
        result.results.push({ eventId: entry.id, outcome: "rejected", error });
        settled.add(entry);
      }
      result.rejectedCount += batch.length;
      report(error);
      delivered = true;
      return true;
    }

    const answers = isRecord(body) && Array.isArray(body.results) ? body.results : null;
    if (!answers) return false;
    batch.forEach((entry, index) => {
      const answer = answers.find((item) => isRecord(item) && item.index === index) ?? answers[index];
      if (!isRecord(answer)) return;
      const outcome = answer.outcome;
      if (outcome === "accepted" || outcome === "replayed") {
        const eventResult: DiditEventResult = { eventId: entry.id, outcome };
        if (typeof answer.event_uuid === "string") eventResult.eventUuid = answer.event_uuid;
        if (typeof answer.status === "string") eventResult.status = answer.status;
        if (typeof answer.score === "number" || answer.score === null) eventResult.score = answer.score;
        result.results.push(eventResult);
        result[outcome === "accepted" ? "acceptedCount" : "replayedCount"]++;
      } else {
        const error = new DiditEventError("validation", "Didit rejected the event; see errors for the details.", {
          status: response.status,
          eventIds: [entry.id],
          errors: answer.errors
        });
        result.results.push({ eventId: entry.id, outcome: "rejected", error });
        result.rejectedCount++;
        report(error);
      }
      settled.add(entry);
    });
    delivered = true;
    return true;
  } catch {
    return false;
  } finally {
    queue = queue.filter((entry) => !settled.has(entry));
    for (const entry of batch) entry.sending = false;
    failures = delivered ? 0 : failures + 1;
    if (keepalive) scheduleWaiting();
  }
}

function emptyResult(): DiditEventFlushResult {
  return { acceptedCount: 0, replayedCount: 0, rejectedCount: 0, pendingCount: 0, results: [] };
}

async function drain(): Promise<DiditEventFlushResult> {
  clearTimer();
  const result = emptyResult();
  let batch: QueuedEvent[];
  while ((batch = nextBatch()).length) {
    if (!(await send(batch, result))) break;
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
function sendOnExit(): void {
  clearTimer();
  let budget = KEEPALIVE_BUDGET_BYTES;
  let batch: QueuedEvent[];
  while ((batch = nextBatch(budget)).length) {
    budget -= batch.reduce((bytes, entry) => bytes + entry.bytes, REQUEST_ALLOWANCE_BYTES);
    void send(batch, emptyResult(), true);
  }
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
    bytes: new TextEncoder().encode(json).length,
    token,
    url: `${(options.baseUrl ?? settings.baseUrl).replace(/\/+$/, "")}${BATCH_PATH}`,
    priority: NEVER_DROPPED.test(kind) ? PRIORITY_NEVER_DROPPED : LOW_VALUE.test(kind) ? 0 : 1,
    sending: false
  });

  listen();
  // Collected now so the batch sent while the page closes does not have to wait for it.
  void getDeviceFingerprintPayload().catch(() => null);
  if (!flushing && !failures && waiting().length >= settings.batchSize) {
    void flush();
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
}
