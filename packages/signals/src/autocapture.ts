/**
 * `@didit-protocol/signals/autocapture`: a person's activity on your site, sent as events without
 * a `submitEvent` call for each one.
 *
 * ```ts
 * import { startAutocapture } from "@didit-protocol/signals/autocapture";
 *
 * startAutocapture({ monitoringToken: () => session.monitoringToken });
 * ```
 *
 * What it sends, all through the same queue as `submitEvent`:
 * - `session.session_started`, once per browser tab session;
 * - `session.page_view` on every page and every single-page-app navigation, with the path;
 * - the event an element declares: `<a data-didit-event="auth.password_forgot">`, on click, or
 *   `<form data-didit-event="auth.login">`, on submit;
 * - `session.bot_signal_observed`, once per page the person acted on: how they acted (how many
 *   actions, how regular their timing, how the pointer moved), never what they typed or clicked.
 *
 * What it never reads: field values, key presses, page text, element ids, query strings.
 */
import {
  type DiditEvent,
  type DiditEventCategory,
  getDeviceFingerprintPayload,
  submitEvent,
} from "@didit-protocol/signals";

interface AutocaptureOptions {
  /**
   * The monitoring token of the signed-in person, or a function that returns it. A function is
   * read for every event, so it can return a renewed token, and null while nobody is signed in:
   * what happens until then is kept (up to `preAuthBuffer` events) and sent with the first token.
   */
  monitoringToken: string | (() => string | null | undefined);
  /** Didit verification API base URL. @default the one configured with configureEvents */
  baseUrl?: string;
  /** Send `session.session_started` and `session.page_view`. @default true */
  pageViews?: boolean;
  /** Send the events elements declare with `data-didit-event`. @default true */
  declaredActions?: boolean;
  /** Send `session.bot_signal_observed` with how the person interacted. @default true */
  behavior?: boolean;
  /**
   * The path to report for a page. The default drops the query string and the fragment and
   * replaces what looks like an identifier (a number, a UUID, a long token, an email address)
   * with `:id`, so `/users/48213/orders` is reported as `/users/:id/orders`. It is given the path
   * as the app routes it, which includes the route of a hash router (`/#/settings`).
   */
  sanitizePath?: (pathname: string) => string;
  /** Events kept while there is no token yet, sent with the first one. 0 keeps none. @default 25 */
  preAuthBuffer?: number;
  /** Events autocapture may send in one browser tab session. @default 500 */
  maxEvents?: number;
}

const CATEGORIES: readonly DiditEventCategory[] = [
  "auth",
  "session",
  "gameplay",
  "bonus",
  "affiliate",
  "payment",
  "dispute",
  "security",
  "responsible_gambling",
  "custom",
];

const SESSION_ID_KEY = "didit-sid-v1";
const SEQUENCE_KEY = "didit-seq-v1";
const COUNT_KEY = "didit-sent-v1";
/** The telemetry fields of `session.bot_signal_observed`, as the Didit events API defines them. */
const TELEMETRY_SCHEMA_VERSION = 1;
/** Fewer actions than this say nothing about how regular someone's timing is. */
const MIN_ACTIONS_FOR_TELEMETRY = 5;
const POINTER_SAMPLE_MS = 50;
const SCROLL_BURST_MS = 400;

interface PendingEvent {
  event: DiditEvent;
}

interface State {
  options: AutocaptureOptions;
  sessionId: string;
  path: string;
  enteredAt: number;
  buffer: PendingEvent[];
  behavior: BehaviorTracker | null;
  teardown: (() => void)[];
}

let state: State | null = null;

// ---------------------------------------------------------------------------------------------
// Session: one id and one counter per browser tab session, kept across full page loads.
// ---------------------------------------------------------------------------------------------

/** sessionStorage, or a per-page fallback where it is blocked. */
const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string): void {
  memory.set(key, value);
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Storage is blocked: the value lives for this page only.
  }
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    // Only where the browser has no WebCrypto: the id groups one tab's events, it protects nothing.
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function nextCount(key: string): number {
  const next = (Number(read(key)) || 0) + 1;
  write(key, String(next));
  return next;
}

// ---------------------------------------------------------------------------------------------
// What is reported about a page: its path, never its query string or fragment.
// ---------------------------------------------------------------------------------------------

/**
 * Whether a path segment names one record rather than a page: a number, a UUID, a long
 * hexadecimal string, an email address, or a long token (letters of both cases and digits, which a
 * readable slug such as `how-to-verify-your-identity` does not have).
 */
function looksLikeIdentifier(segment: string): boolean {
  return (
    /^\d+$/.test(segment) ||
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(segment) ||
    /^[0-9a-fA-F]{16,}$/.test(segment) ||
    /@|%40/.test(segment) ||
    (/^[A-Za-z0-9_-]{20,}$/.test(segment) && /\d/.test(segment) && /[a-z]/.test(segment) && /[A-Z]/.test(segment))
  );
}

/** The path with every segment that looks like an identifier replaced by `:id`. */
function defaultSanitizePath(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => (looksLikeIdentifier(segment) ? ":id" : segment))
    .join("/");
}

/**
 * The page's path as the app routes it: the URL's path, plus the route a hash router keeps in the
 * fragment (`/#/settings/security`). Never the query string, and no other fragment.
 */
function routedPath(): string {
  const hashRoute = /^#!?(\/[^?#]*)/.exec(location.hash);
  if (!hashRoute) return location.pathname;
  return (location.pathname === "/" ? "" : location.pathname.replace(/\/$/, "")) + hashRoute[1];
}

function currentPath(options: AutocaptureOptions): string {
  const sanitize = options.sanitizePath ?? defaultSanitizePath;
  try {
    return sanitize(routedPath()) || "/";
  } catch {
    return "/";
  }
}

/** The host a visit came from: enough to tell a search engine from a phishing page, no URL. */
function referrerHost(): string | undefined {
  try {
    return document.referrer ? new URL(document.referrer).host : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------
// Sending: every event carries the session, and waits for a token when there is none yet.
// ---------------------------------------------------------------------------------------------

function token(options: AutocaptureOptions): string | null {
  try {
    const value = typeof options.monitoringToken === "function" ? options.monitoringToken() : options.monitoringToken;
    return typeof value === "string" && value.trim() ? value : null;
  } catch {
    return null;
  }
}

/**
 * Hands one event to the queue, unless this tab session has sent its share. An event counts when
 * it is sent: one that was dropped, or is still waiting for a token, must not use up what the
 * signed-in part of the visit has left.
 */
function send(current: State, monitoringToken: string, event: DiditEvent): void {
  const alreadySent = Number(read(COUNT_KEY)) || 0;
  if (alreadySent >= (current.options.maxEvents ?? 500)) return;
  write(COUNT_KEY, String(alreadySent + 1));
  try {
    submitEvent({ monitoringToken, event, baseUrl: current.options.baseUrl });
  } catch {
    // An event that cannot be queued (a token with characters no header carries) is not worth
    // breaking the page for: submitEvent has told onError already where it could.
  }
}

function emit(category: DiditEventCategory, actionType: string, payload: Record<string, unknown> = {}): void {
  const current = state;
  if (!current) return;
  const monitoringToken = token(current.options);
  const bufferLimit = current.options.preAuthBuffer ?? 25;
  // Nobody is signed in and nothing is kept for later: the event goes nowhere.
  if (!monitoringToken && bufferLimit <= 0) return;
  if ((Number(read(COUNT_KEY)) || 0) >= (current.options.maxEvents ?? 500)) return;

  const event: DiditEvent = {
    category,
    actionType,
    occurredAt: new Date(),
    session: {
      sessionId: current.sessionId,
      sequence: nextCount(SEQUENCE_KEY),
      // The page without its query string or fragment: both can carry tokens and addresses.
      pageUrl: `${location.origin}${current.path}`,
    },
    payload: { path: current.path, ...payload },
  };

  if (monitoringToken) {
    for (const pending of current.buffer.splice(0)) send(current, monitoringToken, pending.event);
    send(current, monitoringToken, event);
    return;
  }
  // Nobody is signed in yet: keep the newest events, marked as from before the sign-in.
  event.payload = { ...event.payload, pre_auth: true };
  current.buffer.push({ event });
  if (current.buffer.length > bufferLimit) current.buffer.shift();
}

/**
 * Sends one event of your own with the session and the page attached, as the automatic ones
 * have: `track("auth", "password_forgot")`. Does nothing before `startAutocapture`.
 */
function track(category: DiditEventCategory, actionType: string, payload?: Record<string, unknown>): void {
  emit(category, actionType, payload);
}

// ---------------------------------------------------------------------------------------------
// Page views, on a load and on every navigation of a single-page app.
// ---------------------------------------------------------------------------------------------

function pageView(current: State, previousPath?: string): void {
  const now = Date.now();
  emit(
    "session",
    "page_view",
    previousPath === undefined
      ? { referrer_host: referrerHost() }
      : { previous_path: previousPath, seconds_on_previous: Math.round((now - current.enteredAt) / 1000) },
  );
  current.enteredAt = now;
}

function onNavigation(): void {
  const current = state;
  if (!current) return;
  const path = currentPath(current.options);
  if (path === current.path) return;
  // What the person did on the page they are leaving is reported under that page, and never
  // carried into the next one: too few actions to say anything are dropped with the page.
  current.behavior?.report();
  current.behavior?.reset();
  const previous = current.path;
  current.path = path;
  if (current.options.pageViews !== false) pageView(current, previous);
}

function watchNavigation(current: State): void {
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method];
    const patched = function (this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args);
      onNavigation();
      return result;
    };
    history[method] = patched;
    current.teardown.push(() => {
      // Put the original back only if nobody patched it after us.
      if (history[method] === patched) history[method] = original;
    });
  }
  for (const type of ["popstate", "hashchange"] as const) {
    addEventListener(type, onNavigation);
    current.teardown.push(() => removeEventListener(type, onNavigation));
  }
}

// ---------------------------------------------------------------------------------------------
// Declared actions: <a data-didit-event="auth.password_forgot">, <form data-didit-event="auth.login">.
// ---------------------------------------------------------------------------------------------

function declaredEvent(element: Element): { category: DiditEventCategory; actionType: string } | null {
  const declared = (element.getAttribute("data-didit-event") || "").trim();
  if (!declared) return null;
  const dot = declared.indexOf(".");
  const category = declared.slice(0, dot) as DiditEventCategory;
  if (dot > 0 && CATEGORIES.includes(category) && declared.length > dot + 1) {
    return { category, actionType: declared.slice(dot + 1) };
  }
  return { category: "custom", actionType: declared };
}

/** `data-didit-prop-method="passkey"` becomes `{ method: "passkey" }` in the event's payload. */
function declaredProps(element: Element): Record<string, string> {
  const props: Record<string, string> = {};
  for (const attribute of Array.from(element.attributes)) {
    if (!attribute.name.startsWith("data-didit-prop-")) continue;
    if (Object.keys(props).length >= 8) break;
    props[attribute.name.slice("data-didit-prop-".length).replace(/-/g, "_")] = attribute.value.slice(0, 128);
  }
  return props;
}

function onDeclared(event: Event): void {
  const target = event.target instanceof Element ? event.target.closest("[data-didit-event]") : null;
  if (!target) return;
  // A form declares what submitting it means; a click inside it is not that.
  if ((target.tagName === "FORM") !== (event.type === "submit")) return;
  const declared = declaredEvent(target);
  if (declared) emit(declared.category, declared.actionType, declaredProps(target));
}

function watchDeclaredActions(current: State): void {
  for (const type of ["click", "submit"] as const) {
    document.addEventListener(type, onDeclared, true);
    current.teardown.push(() => document.removeEventListener(type, onDeclared, true));
  }
}

// ---------------------------------------------------------------------------------------------
// Behaviour: how a person interacts with the page, in numbers. Never what they type or click.
// ---------------------------------------------------------------------------------------------

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function standardDeviation(values: number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

/** Shannon entropy, in bits, of how often each bucket was hit: 0 when every hit is in one bucket. */
function entropy(buckets: number[]): number {
  const total = buckets.reduce((sum, count) => sum + count, 0);
  if (!total) return 0;
  return buckets.reduce((bits, count) => (count ? bits - (count / total) * Math.log2(count / total) : bits), 0);
}

interface BehaviorTracker {
  /** Sends what was observed on the current page, if it is enough to say anything, and starts over. */
  report: () => void;
  /** Forgets what was observed so far: the page it was observed on is gone. */
  reset: () => void;
  stop: () => void;
}

function trackBehavior(): BehaviorTracker {
  // Read once, ahead of time: a page that is closing cannot wait for it.
  let bot: { score: number; flags: string[] } | null = null;
  getDeviceFingerprintPayload()
    .then((fingerprint) => {
      bot = fingerprint ? fingerprint.bot : null;
    })
    .catch(() => undefined);
  let actionTimes: number[] = [];
  let keyTimes: number[] = [];
  let directions = new Array<number>(8).fill(0);
  let untrusted = 0;
  let lastPointer: { x: number; y: number; at: number } | null = null;
  let lastScrollAt = 0;
  let startedAt = performance.now();

  const action = (event: Event) => {
    actionTimes.push(performance.now());
    // An event a script dispatched, not a person or a browser driver's real input.
    if (event.isTrusted === false) untrusted += 1;
  };
  const onPointerDown = (event: Event) => action(event);
  const onKeyDown = (event: Event) => {
    // The time of a key press, and nothing else about it.
    keyTimes.push(performance.now());
    action(event);
  };
  const onScroll = (event: Event) => {
    const now = performance.now();
    // One gesture fires many scroll events: count the gesture.
    if (now - lastScrollAt > SCROLL_BURST_MS) action(event);
    lastScrollAt = now;
  };
  const onPointerMove = (event: Event) => {
    const { clientX: x, clientY: y } = event as PointerEvent;
    const at = performance.now();
    if (lastPointer && at - lastPointer.at < POINTER_SAMPLE_MS) return;
    if (lastPointer && (x !== lastPointer.x || y !== lastPointer.y)) {
      const angle = Math.atan2(y - lastPointer.y, x - lastPointer.x);
      directions[Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 8) % 8] += 1;
    }
    lastPointer = { x, y, at };
  };

  const listeners: [string, (event: Event) => void][] = [
    ["pointerdown", onPointerDown],
    ["keydown", onKeyDown],
    ["scroll", onScroll],
    ["pointermove", onPointerMove],
  ];
  for (const [type, listener] of listeners) {
    document.addEventListener(type, listener, { capture: true, passive: true });
  }

  const reset = () => {
    actionTimes = [];
    keyTimes = [];
    directions = new Array<number>(8).fill(0);
    untrusted = 0;
    lastPointer = null;
    startedAt = performance.now();
  };

  const intervals = (times: number[]) => times.slice(1).map((time, index) => time - times[index]);

  const report = () => {
    const actions = actionTimes.length;
    if (actions < MIN_ACTIONS_FOR_TELEMETRY) return;
    const gaps = intervals(actionTimes);
    const keyGaps = intervals(keyTimes);
    const moves = directions.reduce((sum, count) => sum + count, 0);
    const observedMs = performance.now() - startedAt;
    const payload: Record<string, unknown> = {
      telemetry_schema_version: TELEMETRY_SCHEMA_VERSION,
      actions,
      observed_seconds: Math.round(observedMs / 1000),
      // Over one second at least: three taps in 100 ms are not 1,800 actions a minute.
      actions_per_minute: round(actions / Math.max(observedMs / 60000, 1 / 60)),
      // How regular the time between two actions is. A script's is nearly constant.
      timing_variance_ms: round(standardDeviation(gaps)),
      reaction_time_ms_p50: Math.round(median(gaps)),
      untrusted_actions: untrusted,
    };
    // How varied the pointer's direction was, 0 to 3 bits. A person's hand wanders; a script
    // moves in a straight line, or not at all (a touch screen has no pointer path either).
    if (moves >= 8) payload.pointer_entropy = round(entropy(directions));
    if (keyGaps.length >= 8) {
      // How varied the rhythm of typing was, from the time between key presses alone.
      const buckets = new Array<number>(8).fill(0);
      for (const gap of keyGaps) buckets[Math.min(7, Math.floor(gap / 60))] += 1;
      payload.keystroke_entropy = round(entropy(buckets));
    }
    // The browser's own automation flags, on the 0-100 scale event rules read.
    if (bot) {
      payload.bot_score = Math.round(bot.score * 100);
      if (bot.flags.length) payload.bot_flags = bot.flags.join(",");
    }
    reset();
    emit("session", "bot_signal_observed", payload);
  };

  return {
    report,
    reset,
    stop: () => {
      for (const [type, listener] of listeners) document.removeEventListener(type, listener, true);
    },
  };
}

// ---------------------------------------------------------------------------------------------

/**
 * Starts sending a person's activity as events. Call it once when your app starts; calling it
 * again replaces the options. Returns a function that stops it and removes every listener.
 *
 * Nothing is sent outside a browser.
 */
function startAutocapture(options: AutocaptureOptions): () => void {
  stopAutocapture();
  if (typeof window === "undefined" || typeof document === "undefined") return stopAutocapture;

  const existing = read(SESSION_ID_KEY);
  const sessionId = existing || randomId();
  if (!existing) write(SESSION_ID_KEY, sessionId);

  const current: State = {
    options,
    sessionId,
    path: currentPath(options),
    enteredAt: Date.now(),
    buffer: [],
    behavior: null,
    teardown: [],
  };
  state = current;

  if (options.behavior !== false) {
    const behavior = trackBehavior();
    current.behavior = behavior;
    const onHidden = () => {
      if (document.visibilityState === "hidden") behavior.report();
    };
    // Registered before the first event is queued, and in the capture phase: the queue sends what
    // is waiting when the page is hidden, and this has to be in it by then.
    document.addEventListener("visibilitychange", onHidden, true);
    addEventListener("pagehide", behavior.report, true);
    current.teardown.push(() => {
      behavior.stop();
      document.removeEventListener("visibilitychange", onHidden, true);
      removeEventListener("pagehide", behavior.report, true);
    });
  }
  if (options.pageViews !== false) {
    if (!existing) emit("session", "session_started", { referrer_host: referrerHost() });
    pageView(current);
  }
  watchNavigation(current);
  if (options.declaredActions !== false) watchDeclaredActions(current);
  return stopAutocapture;
}

/** Stops autocapture: removes its listeners and forgets what was waiting for a token. */
function stopAutocapture(): void {
  const current = state;
  state = null;
  if (current) for (const undo of current.teardown.splice(0)) undo();
}

/**
 * The identifiers of this device, for an event your backend sends itself (`POST /v3/events/`):
 * pass them as the event's `device_context`. Use it where the person is not signed in yet (a
 * forgotten password, a failed sign-in), so that event meets the same device as the ones sent here.
 */
async function getDeviceContext(): Promise<{ persistent_device_id?: string; fingerprint?: string; bot_score?: number }> {
  const fingerprint = await getDeviceFingerprintPayload().catch(() => null);
  if (!fingerprint) return {};
  return {
    ...(fingerprint.persistentId ? { persistent_device_id: fingerprint.persistentId } : {}),
    ...(fingerprint.compositeHash ? { fingerprint: fingerprint.compositeHash } : {}),
    bot_score: Math.round(fingerprint.bot.score * 100),
  };
}

function resetAutocaptureForTesting(): void {
  stopAutocapture();
  memory.clear();
  try {
    for (const key of [SESSION_ID_KEY, SEQUENCE_KEY, COUNT_KEY]) sessionStorage.removeItem(key);
  } catch {
    // ignored
  }
}

export {
  type AutocaptureOptions,
  defaultSanitizePath,
  getDeviceContext,
  resetAutocaptureForTesting,
  startAutocapture,
  stopAutocapture,
  track,
};
