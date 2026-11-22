import {
  BANK_LINK_DEFAULT_API_ORIGIN,
  BANK_LINK_DEFAULT_ORIGIN,
  BANK_LINK_FRAME_POLICY_PATH,
  BANK_LINK_FRAME_POLICY_TIMEOUT_MS,
  BANK_LINK_IFRAME_ALLOW,
  BANK_LINK_INSTANCE_STORAGE_KEY,
  BANK_LINK_MESSAGE_PREFIX,
  BANK_LINK_POPUP_NAME,
  BANK_LINK_PROTOCOL_VERSION,
  BANK_LINK_RESUME_MAX_AGE_MS,
  BANK_LINK_RESUME_QUERY_PARAM,
  BANK_LINK_RESUME_STORAGE_KEY,
  SDK_VERSION
} from "./constants";
import { VerificationModal } from "./modal";
import { getBankLinkModalTranslations } from "./translations";
import type {
  BankLinkEvent,
  BankLinkEventName,
  BankLinkExit,
  BankLinkHandle,
  BankLinkOptions,
  BankLinkResumeOptions,
  BankLinkResumeResult,
  BankLinkState,
  BankLinkSuccess
} from "./types";
import { SDKLogger } from "./utils";

/** Thrown synchronously by `openBankLink` before any frame exists. It never carries the token. */
export class DiditBankLinkError extends Error {
  readonly code: "invalid_token" | "invalid_container" | "invalid_options";

  constructor(code: DiditBankLinkError["code"], message: string) {
    super(message);
    this.name = "DiditBankLinkError";
    this.code = code;
  }
}

/** The pieces tests replace: the page navigation, the clock and the popup call. Not part of the public API. */
export const bankLinkRuntime = {
  navigate: (url: string): void => window.location.assign(url),
  now: (): number => Date.now(),
  /** The frame-policy call: JSON in, the parsed JSON out; it throws on a network error, a timeout or a non-2xx answer. */
  fetchPolicy: async (url: string, body: { token: string } | { resume_code: string }, signal: AbortSignal): Promise<unknown> => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal
    });
    if (!response.ok) throw new Error(`frame-policy answered ${response.status}`);
    // An answer that is not JSON reached us fine: it is an unusable answer, not a network failure.
    return response.json().catch(() => undefined);
  },
  openPopup: (): Window | null => window.open("about:blank", BANK_LINK_POPUP_NAME, "popup,width=520,height=760")
};

const CLIENT_TOKEN_PATTERN = /^blt_[A-Za-z0-9_-]{16,}$/;
const URL_TOKEN_PATTERN = /^bl[tu]_[A-Za-z0-9_-]{16,}$/;
/** A resume code travels in a query or a fragment: RFC 3986 unreserved characters only (the backend's codes are `rsc_<id>.<secret>`). */
const RESUME_CODE_PATTERN = /^[A-Za-z0-9._~-]{8,256}$/;
const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const POPUP_POLL_MS = 500;

// ---------------------------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------------------------

/** The exact origin the SDK reads from and posts to, from `baseUrl`. HTTPS only (HTTP only for localhost). */
export function resolveBankLinkOrigin(baseUrl: string | undefined, name = "baseUrl", fallback = BANK_LINK_DEFAULT_ORIGIN): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl ?? fallback);
  } catch {
    throw new DiditBankLinkError("invalid_options", `${name} is not a valid URL.`);
  }
  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocal)) {
    throw new DiditBankLinkError("invalid_options", `${name} must be an https URL.`);
  }
  return parsed.origin;
}

/**
 * The bare token of a `client_token` or of a hosted link URL on the Didit origin. Anything else is
 * refused before a frame exists, and the message never repeats the value.
 */
export function parseBankLinkToken(token: unknown, origin: string): string {
  const invalid = () => new DiditBankLinkError("invalid_token", "token must be a Bank Link client token (blt_...) or its hosted URL.");
  if (typeof token !== "string") throw invalid();
  const value = token.trim();
  if (CLIENT_TOKEN_PATTERN.test(value)) return value;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw invalid();
  }
  if (parsed.origin !== origin) throw invalid();
  const fromHash = new URLSearchParams(parsed.hash.replace(/^#/, "")).get("t");
  const lastSegment = parsed.pathname.split("/").filter(Boolean).pop();
  const candidate = fromHash ?? lastSegment ?? "";
  if (!URL_TOKEN_PATTERN.test(candidate)) throw invalid();
  return candidate;
}

function resolveContainer(container: BankLinkOptions["container"]): HTMLElement | null {
  if (container === undefined || container === null) return null;
  if (typeof container === "string") {
    let found: Element | null = null;
    try {
      found = document.querySelector(container);
    } catch {
      found = null;
    }
    if (!(found instanceof HTMLElement)) {
      throw new DiditBankLinkError("invalid_container", `container "${container}" was not found in the page.`);
    }
    return found;
  }
  if (typeof HTMLElement !== "undefined" && container instanceof HTMLElement) return container;
  throw new DiditBankLinkError("invalid_container", "container must be a selector or an element.");
}

function assertCallbacks(options: Partial<BankLinkOptions>): void {
  for (const name of ["onSuccess", "onExit", "onEvent"] as const) {
    const value = options[name];
    if (value !== undefined && typeof value !== "function") {
      throw new DiditBankLinkError("invalid_options", `${name} must be a function.`);
    }
  }
  if (options.theme !== undefined && !["light", "dark", "auto"].includes(options.theme)) {
    throw new DiditBankLinkError("invalid_options", 'theme must be "light", "dark" or "auto".');
  }
  if (options.locale !== undefined && (typeof options.locale !== "string" || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(options.locale))) {
    throw new DiditBankLinkError("invalid_options", "locale must be a language code such as es or pt-BR.");
  }
}

// ---------------------------------------------------------------------------------------------
// Origin, source and message checks
// ---------------------------------------------------------------------------------------------

/** Exact origin equality: not a suffix test, not a prefix test. */
export function isExactOrigin(origin: string, expected: string): boolean {
  return origin === expected;
}

type FieldRule =
  | { kind: "string"; optional?: boolean }
  | { kind: "nullable_string"; optional?: boolean }
  | { kind: "number"; optional?: boolean }
  | { kind: "boolean"; optional?: boolean }
  | { kind: "enum"; values: readonly string[]; optional?: boolean }
  | { kind: "code" };

const EXIT_REASONS = ["closed", "cancelled", "bank_unavailable", "expired", "failed", "not_allowed"] as const;

/** The keys of each event's payload; anything else the page sends is stripped, never forwarded. */
const EVENT_FIELDS: Record<BankLinkEventName, Record<string, FieldRule>> = {
  opened: {
    link_id: { kind: "string" },
    mode: { kind: "enum", values: ["connect", "renew"] },
    access: { kind: "enum", values: ["one_time", "ongoing"] },
    presentation: { kind: "string", optional: true }
  },
  consent_shown: { link_id: { kind: "string" }, consent_version: { kind: "string" } },
  consent_accepted: { link_id: { kind: "string" }, consent_version: { kind: "string" } },
  institution_selected: { institution_id: { kind: "string" }, country: { kind: "string" } },
  bank_redirect: { via: { kind: "enum", values: ["popup", "redirect"] } },
  bank_returned: { result: { kind: "enum", values: ["ok", "cancelled", "failed", "timeout", "unsupported"] } },
  accounts_selected: { count: { kind: "number" } },
  success: {
    link_id: { kind: "string" },
    connection_id: { kind: "nullable_string", optional: true },
    check_id: { kind: "nullable_string", optional: true },
    resumed: { kind: "boolean", optional: true }
  },
  exit: {
    reason: { kind: "enum", values: EXIT_REASONS },
    step: { kind: "nullable_string" },
    link_id: { kind: "string", optional: true },
    resumed: { kind: "boolean", optional: true }
  },
  error: { code: { kind: "code" } }
};

const PUBLIC_EVENT_NAMES = Object.keys(EVENT_FIELDS) as BankLinkEventName[];
const MAX_STRING_LENGTH = 256;

function readField(rule: FieldRule, value: unknown): { ok: true; value: unknown } | { ok: false } {
  switch (rule.kind) {
    case "string":
      return typeof value === "string" && value.length > 0 && value.length <= MAX_STRING_LENGTH ? { ok: true, value } : { ok: false };
    case "nullable_string":
      if (value === null) return { ok: true, value: null };
      return typeof value === "string" && value.length <= MAX_STRING_LENGTH ? { ok: true, value } : { ok: false };
    case "number":
      return typeof value === "number" && Number.isInteger(value) && value >= 0 ? { ok: true, value } : { ok: false };
    case "boolean":
      return typeof value === "boolean" ? { ok: true, value } : { ok: false };
    case "enum":
      return typeof value === "string" && rule.values.includes(value) ? { ok: true, value } : { ok: false };
    case "code":
      // A code the SDK does not know becomes "unknown": the page's own error codes are not an API of the SDK.
      return { ok: true, value: typeof value === "string" && ERROR_CODE_PATTERN.test(value) ? value : "unknown" };
  }
}

/** The event with only its allow-listed, well-typed keys, or null when a required key is missing or wrong. */
export function readBankLinkEvent(name: string, data: unknown): BankLinkEvent | null {
  if (!(PUBLIC_EVENT_NAMES as string[]).includes(name)) return null;
  const rules = EVENT_FIELDS[name as BankLinkEventName];
  const source = typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const payload: Record<string, unknown> = { name };
  for (const [key, rule] of Object.entries(rules)) {
    const present = Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined;
    if (!present) {
      if (rule.kind === "code") payload[key] = "unknown";
      else if (!("optional" in rule && rule.optional)) {
        // `exit.step` is null before the first step: a missing one reads as null rather than dropping the exit.
        if (name === "exit" && key === "step") payload[key] = null;
        else return null;
      }
      continue;
    }
    const read = readField(rule, source[key]);
    if (!read.ok) return null;
    payload[key] = read.value;
  }
  return payload as unknown as BankLinkEvent;
}

type TransportName = "close_request" | "open_bank" | "bank_url" | "redirect_request";

interface ParsedMessage {
  name: string;
  data: unknown;
  linkRef: string | null;
}

/** Reads a Bank Link envelope: prefix, `v === 1`, a name; anything else is not for this SDK. */
export function parseBankLinkEnvelope(raw: unknown): ParsedMessage | null {
  let message: unknown = raw;
  if (typeof raw === "string") {
    try {
      message = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof message !== "object" || message === null) return null;
  const { type, v, data, link_ref: linkRef } = message as Record<string, unknown>;
  if (typeof type !== "string" || !type.startsWith(BANK_LINK_MESSAGE_PREFIX)) return null;
  if (v !== BANK_LINK_PROTOCOL_VERSION) return null;
  const name = type.slice(BANK_LINK_MESSAGE_PREFIX.length);
  if (!name) return null;
  return { name, data, linkRef: typeof linkRef === "string" && linkRef.length <= MAX_STRING_LENGTH ? linkRef : null };
}

const FRAME_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/** The frame-policy answer, or null when it is not of the documented shape. */
function readFramePolicy(answer: unknown): { valid: boolean; frameId: string | null; allowedOrigins: string[] } | null {
  if (typeof answer !== "object" || answer === null) return null;
  const { valid, frame_id: frameId, allowed_origins: origins } = answer as Record<string, unknown>;
  if (typeof valid !== "boolean") return null;
  if (!valid) return { valid, frameId: null, allowedOrigins: [] };
  if (typeof frameId !== "string" || !FRAME_ID_PATTERN.test(frameId)) return null;
  if (!Array.isArray(origins) || !origins.every((o) => typeof o === "string")) return null;
  return { valid, frameId, allowedOrigins: origins as string[] };
}

function readRequestId(data: unknown): string | null {
  const id = typeof data === "object" && data !== null ? (data as Record<string, unknown>).request_id : undefined;
  return typeof id === "string" && id.length > 0 && id.length <= 128 ? id : null;
}

// ---------------------------------------------------------------------------------------------
// The frame URL and the page's records (no token ever reaches a storage)
// ---------------------------------------------------------------------------------------------

function randomId(): string {
  const cryptoApi = typeof crypto !== "undefined" ? crypto : undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function readStorage(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // A browser that refuses storage still opens the flow; only the redirect resume is lost.
  }
}

/** The id of this page's tab: it lets the server tell "the same browser reloading the frame" from "another browser". */
function pageInstanceId(): string {
  const stored = readStorage(BANK_LINK_INSTANCE_STORAGE_KEY);
  if (stored && /^[0-9a-f-]{36}$/.test(stored)) return stored;
  const created = randomId();
  writeStorage(BANK_LINK_INSTANCE_STORAGE_KEY, created);
  return created;
}

interface ResumeRecord {
  v: 1;
  instance_id: string;
  link_ref: string | null;
  container: string | null;
  ts: number;
}

function readResumeRecord(): ResumeRecord | null {
  const raw = readStorage(BANK_LINK_RESUME_STORAGE_KEY);
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as Partial<ResumeRecord>;
    const fresh = typeof record.ts === "number" && bankLinkRuntime.now() - record.ts < BANK_LINK_RESUME_MAX_AGE_MS;
    if (record.v === 1 && fresh && typeof record.instance_id === "string") {
      return {
        v: 1,
        instance_id: record.instance_id,
        link_ref: typeof record.link_ref === "string" ? record.link_ref : null,
        container: typeof record.container === "string" ? record.container : null,
        ts: record.ts as number
      };
    }
  } catch {
    // fall through: a record that cannot be read is dropped
  }
  writeStorage(BANK_LINK_RESUME_STORAGE_KEY, null);
  return null;
}

/**
 * The frame URL. The token (or a resume code) is in the fragment only, so it never reaches a server log
 * or a Referer header; the path carries the instance id, which is not a secret.
 */
export function buildBankLinkFrameUrl(input: {
  origin: string;
  /** The path segment: the `frame_id` of the policy answer. */
  framePath: string;
  instanceId: string;
  secret: { token: string } | { resumeCode: string };
  parentOrigin: string;
  presentation: "modal" | "inline";
  locale?: string;
  theme?: BankLinkOptions["theme"];
}): string {
  const params = new URLSearchParams();
  if ("token" in input.secret) params.set("t", input.secret.token);
  else {
    params.set("resume_code", input.secret.resumeCode);
    params.set("resume", "1");
  }
  params.set("instance_id", input.instanceId);
  params.set("parent_origin", input.parentOrigin);
  params.set("v", String(BANK_LINK_PROTOCOL_VERSION));
  params.set("sdk_version", SDK_VERSION);
  params.set("presentation", input.presentation);
  if (input.locale) params.set("locale", input.locale);
  if (input.theme && input.theme !== "auto") params.set("theme", input.theme);
  return `${input.origin}/bank/frame/${encodeURIComponent(input.framePath)}#${params.toString()}`;
}

/** Whether the person is on a phone or a tablet: the bank hop is a full-page redirect there, never a popup. */
function isTouchFirstDevice(): boolean {
  try {
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    return coarse && (navigator.maxTouchPoints ?? 0) > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// One Bank Link on the page
// ---------------------------------------------------------------------------------------------

interface SessionInit {
  options: BankLinkOptions | BankLinkResumeOptions;
  origin: string;
  /** The API origin of the frame-policy call. */
  apiOrigin: string;
  instanceId: string;
  secret: { token: string } | { resumeCode: string };
  token: string | null;
  element: HTMLElement | null;
  containerSelector: string | null;
  resumed: boolean;
}

class BankLinkSession implements BankLinkHandle {
  private _state: BankLinkState = "opening";
  private modal: VerificationModal;
  private linkRef: string | null = null;
  private linkId: string | undefined;
  private ended = false;
  private tornDown = false;
  private redirecting = false;
  private popup: Window | null = null;
  private popupRequestId: string | null = null;
  private popupTimer: number | null = null;

  constructor(private readonly init: SessionInit) {
    const embedded = init.element !== null;
    this.modal = new VerificationModal(
      { embedded, showExitConfirmation: false, showCloseButton: !embedded },
      {
        // The flow closes without asking: the link's own screens already say what leaving means.
        onClose: () => undefined,
        onCloseConfirmed: () => this.close(),
        onMessage: () => undefined,
        onIframeLoad: () => undefined
      },
      {
        iframeAllow: BANK_LINK_IFRAME_ALLOW,
        referrerPolicy: "no-referrer",
        embeddedElement: init.element ?? undefined,
        language: init.options.locale,
        translations: getBankLinkModalTranslations,
        isTrustedOrigin: (origin) => isExactOrigin(origin, init.origin),
        interceptMessage: (message) => this.handleMessage(message)
      }
    );
  }

  get state(): BankLinkState {
    return this._state;
  }

  private policyAbort: AbortController | null = null;

  /**
   * Asks the API whether this token may be embedded on this page, then loads the frame at the path of the
   * answer's `frame_id`. Any refusal or failure ends the flow with events and no frame, never a hung
   * "opening" state. A resume asks with its resume code, which the call does not consume.
   */
  async start(): Promise<void> {
    const controller = new AbortController();
    this.policyAbort = controller;
    const timer = window.setTimeout(() => controller.abort(), BANK_LINK_FRAME_POLICY_TIMEOUT_MS);
    let answer: unknown;
    try {
      answer = await bankLinkRuntime.fetchPolicy(
        `${this.init.apiOrigin}${BANK_LINK_FRAME_POLICY_PATH}`,
        "token" in this.init.secret ? { token: this.init.secret.token } : { resume_code: this.init.secret.resumeCode },
        controller.signal
      );
    } catch {
      window.clearTimeout(timer);
      if (!this.tornDown) this.refuse("network", "failed");
      return;
    }
    window.clearTimeout(timer);
    if (this.tornDown) return;
    const policy = readFramePolicy(answer);
    if (!policy) {
      // The service answered, but not in the documented shape (for example a frame id the SDK refuses): nothing is wrong
      // with the network, so the host is not told "network". "unknown" is the code the SDK already uses for a value it cannot use.
      console.warn("[Didit] Bank Link was not opened: the frame-policy answer could not be used.");
      return this.refuse("unknown", "failed");
    }
    if (!policy.valid) return this.refuse("invalid_token", "not_allowed");
    if (!policy.allowedOrigins.includes(window.location.origin)) {
      console.warn(
        `[Didit] Bank Link was not opened: this page's origin (${window.location.origin}) is not in the link's allowed_origins. ` +
          "Add it to the link's allowed_origins or to the application's Bank Link setting."
      );
      return this.refuse("origin_not_allowed", "not_allowed");
    }
    this.loadFrame(policy.frameId as string);
  }

  /** No frame was created: report why, end the flow and release everything. */
  private refuse(code: string, reason: BankLinkExit["reason"]): void {
    if (this.tornDown) return;
    this.emit({ name: "error", code });
    this.ended = true;
    this.emit({ name: "exit", reason, step: null });
    this.teardown();
  }

  private loadFrame(framePath: string): void {
    const url = buildBankLinkFrameUrl({
      origin: this.init.origin,
      framePath,
      instanceId: this.init.instanceId,
      secret: this.init.secret,
      parentOrigin: window.location.origin,
      presentation: this.init.element ? "inline" : "modal",
      locale: this.init.options.locale,
      theme: this.init.options.theme
    });
    this.modal.open(url);
  }

  /** The host's own close, the person's close button, or a newer link replacing this one. */
  close(): void {
    if (this.tornDown) return;
    if (!this.ended) {
      this.ended = true;
      this.emit({ name: "exit", reason: "closed", step: null, ...(this.linkId ? { link_id: this.linkId } : {}) });
    }
    this.teardown();
  }

  /** Removes the frame and every listener without telling the host (the page is about to leave, or the flow is over). */
  teardown(): void {
    if (this.tornDown) return;
    this.tornDown = true;
    this._state = "closed";
    this.policyAbort?.abort();
    this.closePopup();
    this.modal.destroy();
    if (activeSession === this) activeSession = null;
  }

  // -- messages ------------------------------------------------------------------------------

  /** Called by the frame host for a message from this frame's window and the exact Didit origin. */
  private handleMessage(raw: unknown): boolean {
    const message = parseBankLinkEnvelope(raw);
    if (!message) return false; // not a Bank Link message: the frame host handles layout and the rest
    if (this.tornDown) return true;
    if (message.linkRef !== null) {
      if (this.linkRef === null) this.linkRef = message.linkRef;
      else if (this.linkRef !== message.linkRef) return true;
    } else if (this.linkRef !== null) {
      return true;
    }
    switch (message.name as TransportName) {
      case "close_request":
        this.close();
        return true;
      case "open_bank":
        this.openBank(readRequestId(message.data));
        return true;
      case "bank_url":
        this.navigatePopup(message.data);
        return true;
      case "redirect_request":
        this.redirectToHostedPage(message.data);
        return true;
      default:
        break;
    }
    const event = readBankLinkEvent(message.name, message.data);
    if (event) this.deliver(event);
    return true;
  }

  private deliver(event: BankLinkEvent): void {
    if (event.name === "opened") {
      this.linkId = event.link_id;
      this._state = "open";
    }
    if (event.name === "success" || event.name === "exit") {
      if (this.ended) return; // success and exit never both fire, and neither fires twice
      this.ended = true;
      if (this.init.resumed) event.resumed = true;
      if ("link_id" in event && typeof event.link_id === "string") this.linkId = event.link_id;
    }
    this.emit(event);
    if (this.init.resumed && this.ended) {
      // A replayed result needs no screen: the host has its answer, and the record is spent.
      writeStorage(BANK_LINK_RESUME_STORAGE_KEY, null);
      this.teardown();
    }
  }

  private emit(event: BankLinkEvent): void {
    const { onEvent, onSuccess, onExit } = this.init.options;
    const call = (fn: (() => void) | undefined) => {
      try {
        fn?.();
      } catch (error) {
        // A host callback that throws must not break the flow or the next callback.
        SDKLogger.error("Bank Link callback threw:", error);
      }
    };
    call(onEvent ? () => onEvent({ ...event }) : undefined);
    if (event.name === "success") {
      const { name: _name, ...result } = event;
      call(onSuccess ? () => onSuccess(result as BankLinkSuccess) : undefined);
    } else if (event.name === "exit") {
      const { name: _name, ...result } = event;
      call(onExit ? () => onExit(result as BankLinkExit) : undefined);
    }
  }

  // -- the bank hop --------------------------------------------------------------------------

  private postToFrame(type: string, data: Record<string, unknown>): void {
    const target = this.modal.frameWindow();
    if (!target) return;
    target.postMessage(
      { type: `${BANK_LINK_MESSAGE_PREFIX}${type}`, v: BANK_LINK_PROTOCOL_VERSION, data, timestamp: bankLinkRuntime.now() },
      this.init.origin
    );
  }

  private reportPopup(requestId: string, state: "opened" | "blocked" | "closed"): void {
    this.postToFrame("popup_state", { request_id: requestId, state });
  }

  /** The frame wants the bank in a window. A phone, or a browser that blocks the window, gets a redirect instead. */
  private openBank(requestId: string | null): void {
    if (!requestId) return;
    this.closePopup();
    if (isTouchFirstDevice()) {
      this.reportPopup(requestId, "blocked");
      return;
    }
    let popup: Window | null = null;
    try {
      popup = bankLinkRuntime.openPopup();
    } catch {
      popup = null;
    }
    if (!popup || popup.closed) {
      this.reportPopup(requestId, "blocked");
      this.emit({ name: "error", code: "popup_blocked" });
      return;
    }
    // The bank must never get a handle to this page; this window stays ours to navigate and watch.
    try {
      popup.opener = null;
    } catch {
      // not settable in this browser: the bank URL is still https and carries nothing of ours
    }
    this.popup = popup;
    this.popupRequestId = requestId;
    this.popupTimer = window.setInterval(() => {
      if (this.popup && this.popup.closed) {
        const id = this.popupRequestId;
        this.closePopup();
        if (id) this.reportPopup(id, "closed");
      }
    }, POPUP_POLL_MS);
    this.reportPopup(requestId, "opened");
  }

  /** The frame has the bank's address (one-time, no token in it); only an https address goes into the popup. */
  private navigatePopup(data: unknown): void {
    const requestId = readRequestId(data);
    const url = typeof data === "object" && data !== null ? (data as Record<string, unknown>).url : undefined;
    if (!this.popup || this.popup.closed || !requestId || requestId !== this.popupRequestId) return;
    if (typeof url !== "string") return;
    try {
      if (new URL(url).protocol !== "https:") return;
      this.popup.location.href = url;
    } catch {
      // an address the browser cannot parse is not opened
    }
  }

  private closePopup(): void {
    if (this.popupTimer !== null) {
      window.clearInterval(this.popupTimer);
      this.popupTimer = null;
    }
    try {
      if (this.popup && !this.popup.closed) this.popup.close();
    } catch {
      // a window that cannot be closed is left to the person
    }
    this.popup = null;
    this.popupRequestId = null;
  }

  /**
   * No popup (blocked, or a phone): the whole page goes to the hosted link page and comes back to the page
   * the integrator registered. The resume record lets `resumeBankLink` reopen the result there.
   */
  private redirectToHostedPage(data: unknown): void {
    if (this.redirecting) return;
    const code = typeof data === "object" && data !== null ? (data as Record<string, unknown>).resume_code : undefined;
    const resumeCode = typeof code === "string" && RESUME_CODE_PATTERN.test(code) ? code : null;
    if (!resumeCode && !this.init.token) return; // nothing the hosted page could continue with
    this.redirecting = true;
    this.closePopup();
    const record: ResumeRecord = {
      v: 1,
      instance_id: this.init.instanceId,
      link_ref: this.linkRef,
      container: this.init.containerSelector,
      ts: bankLinkRuntime.now()
    };
    writeStorage(BANK_LINK_RESUME_STORAGE_KEY, JSON.stringify(record));
    const params = new URLSearchParams();
    if (resumeCode) params.set("resume_code", resumeCode);
    else params.set("t", this.init.token as string);
    params.set("resume", "1");
    params.set("instance_id", this.init.instanceId);
    params.set("return", `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`);
    params.set("v", String(BANK_LINK_PROTOCOL_VERSION));
    params.set("sdk_version", SDK_VERSION);
    if (this.init.options.locale) params.set("locale", this.init.options.locale);
    if (this.init.options.theme && this.init.options.theme !== "auto") params.set("theme", this.init.options.theme);
    const target = `${this.init.origin}/bank/link/#${params.toString()}`;
    // The page is leaving: no exit is reported, the flow continues on the other side of the redirect.
    this.ended = true;
    this.teardown();
    bankLinkRuntime.navigate(target);
  }
}

let activeSession: BankLinkSession | null = null;

/** Only one Bank Link at a time: a newer one closes the older with `exit { reason: "closed" }`. */
function replaceActiveSession(): void {
  activeSession?.close();
  activeSession = null;
}

/** Opens Bank Link. See `DiditSdk.openBankLink`. */
export function openBankLink(options: BankLinkOptions): BankLinkHandle {
  if (typeof options !== "object" || options === null) {
    throw new DiditBankLinkError("invalid_options", "openBankLink needs an options object.");
  }
  assertCallbacks(options);
  const origin = resolveBankLinkOrigin(options.baseUrl);
  const apiOrigin = resolveBankLinkOrigin(options.apiBaseUrl, "apiBaseUrl", BANK_LINK_DEFAULT_API_ORIGIN);
  const token = parseBankLinkToken(options.token, origin);
  const element = resolveContainer(options.container);
  replaceActiveSession();
  const session = new BankLinkSession({
    options,
    origin,
    apiOrigin,
    instanceId: pageInstanceId(),
    secret: { token },
    token,
    element,
    containerSelector: typeof options.container === "string" ? options.container : null,
    resumed: false
  });
  activeSession = session;
  void session.start();
  return session;
}

/**
 * On the page the full-page redirect returned to: reopens the flow at its server state with the single-use
 * code the hosted page added to the URL. Safe on every page load: with no record, a record older than 24
 * hours or no code in the URL it does nothing and answers `{ resumed: false }`.
 */
export function resumeBankLink(options: BankLinkResumeOptions = {}): Promise<BankLinkResumeResult> {
  const none: BankLinkResumeResult = { resumed: false };
  try {
    // Everything that can throw is checked before the address or the stored record is touched, so a
    // corrected retry of the call still finds its single-use code.
    assertCallbacks(options);
    const origin = resolveBankLinkOrigin(options.baseUrl);
    const apiOrigin = resolveBankLinkOrigin(options.apiBaseUrl, "apiBaseUrl", BANK_LINK_DEFAULT_API_ORIGIN);
    const record = readResumeRecord();
    if (!record) return Promise.resolve(none);
    const params = new URLSearchParams(window.location.search);
    const code = params.get(BANK_LINK_RESUME_QUERY_PARAM);
    if (!code || !RESUME_CODE_PATTERN.test(code)) return Promise.resolve(none);
    const containerOption = options.container ?? record.container ?? undefined;
    let element: HTMLElement | null = null;
    try {
      element = resolveContainer(containerOption);
    } catch {
      element = null; // the page that came back has no such element: the modal is the way to show it
    }
    // The call is going ahead: the single-use code leaves the address bar and the history at once.
    params.delete(BANK_LINK_RESUME_QUERY_PARAM);
    const query = params.toString();
    try {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    } catch {
      // a browser that refuses to rewrite the address still resumes
    }
    replaceActiveSession();
    const session = new BankLinkSession({
      options,
      origin,
      apiOrigin,
      instanceId: record.instance_id,
      secret: { resumeCode: code },
      token: null,
      element,
      containerSelector: typeof containerOption === "string" ? containerOption : null,
      resumed: true
    });
    activeSession = session;
    void session.start();
    return Promise.resolve({ resumed: true });
  } catch (error) {
    return Promise.reject(error);
  }
}

/** Closes whatever Bank Link is open without a callback; for `DiditSdk.reset()` and tests. */
export function disposeBankLink(): void {
  activeSession?.teardown();
  activeSession = null;
}
