import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { buildEventRequestBody } from "../events";
import type { DiditEvent, SubmitEventOptions } from "../types";

const submitEvent = jest.fn<(options: SubmitEventOptions) => string>();
const fingerprint = { persistentId: "pid-1", compositeHash: "hash-1", bot: { score: 0.9, flags: ["webdriver"] } };

jest.unstable_mockModule("@didit-protocol/signals", () => ({
  submitEvent,
  getDeviceFingerprintPayload: async () => fingerprint,
}));

const { defaultSanitizePath, getDeviceContext, resetAutocaptureForTesting, startAutocapture, stopAutocapture, track } =
  await import("../autocapture");

/** What was handed to the event queue, in order: `category.action`, and the events themselves. */
function sent(): DiditEvent[] {
  return submitEvent.mock.calls.map(([options]) => options.event);
}

function kinds(): string[] {
  return sent().map((event) => `${event.category}.${event.actionType}`);
}

function hidePage(): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
  delete (document as unknown as Record<string, unknown>).visibilityState;
}

beforeEach(() => {
  resetAutocaptureForTesting();
  submitEvent.mockReset();
  history.replaceState({}, "", "/");
  document.body.innerHTML = "";
});

afterEach(() => {
  stopAutocapture();
  jest.useRealTimers();
});

describe("session and page views", () => {
  it("starts the session once and reports every page with its path, never its query string", () => {
    startAutocapture({ monitoringToken: "token-1", behavior: false });

    expect(kinds()).toEqual(["session.session_started", "session.page_view"]);
    const [started, first] = sent();
    expect(started.session).toMatchObject({ sequence: 1, pageUrl: "http://localhost/" });
    expect(first.session).toMatchObject({ sessionId: started.session!.sessionId, sequence: 2 });
    expect(first.payload).toEqual({ path: "/" });
    expect(submitEvent.mock.calls[0][0].monitoringToken).toBe("token-1");

    history.pushState({}, "", "/users/48213/orders?email=someone%40example.com#section");

    const second = sent()[2];
    expect(`${second.category}.${second.actionType}`).toBe("session.page_view");
    expect(second.payload).toMatchObject({ path: "/users/:id/orders", previous_path: "/" });
    expect(second.session).toMatchObject({ sequence: 3, pageUrl: "http://localhost/users/:id/orders" });
    expect(JSON.stringify(second)).not.toMatch(/48213|someone|section/);

    // The same page with another query string is not another page.
    history.replaceState({}, "", "/users/48213/orders?tab=2");
    expect(sent()).toHaveLength(3);
  });

  it("keeps one session across full page loads of the same tab", () => {
    startAutocapture({ monitoringToken: "token-1", behavior: false });
    const sessionId = sent()[0].session!.sessionId;
    stopAutocapture();
    submitEvent.mockReset();

    // A new page load: the script starts again, the tab's session storage is still there.
    startAutocapture({ monitoringToken: "token-1", behavior: false });

    expect(kinds()).toEqual(["session.page_view"]);
    expect(sent()[0].session).toMatchObject({ sessionId, sequence: 3 });
  });

  it("follows a hash router and the back button", () => {
    startAutocapture({ monitoringToken: "token-1", behavior: false });
    submitEvent.mockReset();

    history.pushState({}, "", "/#/settings/security?from=email");
    expect(sent()[0].payload).toMatchObject({ path: "/settings/security", previous_path: "/" });

    history.replaceState({}, "", "/");
    dispatchEvent(new Event("popstate"));
    expect(sent()[1].payload).toMatchObject({ path: "/", previous_path: "/settings/security" });
  });

  it("replaces what identifies a record and keeps what names a page", () => {
    expect(defaultSanitizePath("/orders/48213")).toBe("/orders/:id");
    expect(defaultSanitizePath("/u/3f2b8c1e-9a4d-4c7b-8f21-0a1b2c3d4e5f/edit")).toBe("/u/:id/edit");
    expect(defaultSanitizePath("/reset/9f86d081884c7d659a2feaa0c55ad015")).toBe("/reset/:id");
    expect(defaultSanitizePath("/invite/someone@example.com")).toBe("/invite/:id");
    expect(defaultSanitizePath("/verify/eyJhbGciOiJIUzI1NiJ9abcDEF123")).toBe("/verify/:id");
    expect(defaultSanitizePath("/blog/how-to-verify-your-identity-in-2-minutes")).toBe(
      "/blog/how-to-verify-your-identity-in-2-minutes",
    );
    expect(defaultSanitizePath("/pricing")).toBe("/pricing");
  });

  it("reports the path the integrator's own rule gives", () => {
    startAutocapture({
      monitoringToken: "token-1",
      behavior: false,
      sanitizePath: (pathname) => pathname.replace(/^\/tenant\/[^/]+/, "/tenant/:tenant"),
    });
    history.pushState({}, "", "/tenant/acme/billing");
    expect(sent()[2].payload).toMatchObject({ path: "/tenant/:tenant/billing" });
  });
});

describe("declared actions", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <a id="forgot" data-didit-event="auth.password_forgot" data-didit-prop-sent-by="email"><span id="label">Forgot?</span></a>
      <form id="login" data-didit-event="auth.login"><input name="password" value="hunter2" /><button id="go">Sign in</button></form>
      <button id="plain">Nothing declared</button>
      <button id="own" data-didit-event="newsletter_opened">Open</button>`;
    startAutocapture({ monitoringToken: "token-1", pageViews: false, behavior: false });
  });

  it("sends the event an element declares when it is clicked, with its declared properties", () => {
    document.getElementById("label")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(kinds()).toEqual(["auth.password_forgot"]);
    expect(sent()[0].payload).toEqual({ path: "/", sent_by: "email" });
  });

  it("sends what a form declares when it is submitted, not when something in it is clicked", () => {
    document.querySelector("#login input")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(sent()).toHaveLength(0);

    document.getElementById("login")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(kinds()).toEqual(["auth.login"]);
    // Nothing a field holds is ever read.
    expect(JSON.stringify(sent()[0])).not.toContain("hunter2");
  });

  it("sends a name that is not one of Didit's categories as a custom event, and nothing for an undeclared element", () => {
    document.getElementById("plain")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.getElementById("own")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(kinds()).toEqual(["custom.newsletter_opened"]);
  });
});

describe("before somebody is signed in", () => {
  it("keeps the newest events and sends them, marked, with the first token", () => {
    let token: string | null = null;
    startAutocapture({ monitoringToken: () => token, behavior: false, preAuthBuffer: 3 });
    history.pushState({}, "", "/forgot-password");
    history.pushState({}, "", "/sign-in");
    expect(sent()).toHaveLength(0);

    token = "token-after-sign-in";
    history.pushState({}, "", "/account");

    // session_started fell out of a buffer of three; the three newest are sent first, in order.
    expect(sent().map((event) => event.payload!.path)).toEqual(["/", "/forgot-password", "/sign-in", "/account"]);
    expect(sent().map((event) => event.payload!.pre_auth)).toEqual([true, true, true, undefined]);
    expect(sent().map((event) => event.session!.sequence)).toEqual([2, 3, 4, 5]);
    expect(submitEvent.mock.calls.every(([options]) => options.monitoringToken === "token-after-sign-in")).toBe(true);
  });

  it("keeps nothing when asked not to", () => {
    let token: string | null = null;
    startAutocapture({ monitoringToken: () => token, behavior: false, preAuthBuffer: 0 });
    token = "token-1";
    history.pushState({}, "", "/account");
    expect(sent().map((event) => event.payload!.path)).toEqual(["/account"]);
  });

  it("does not let events nobody received use up the session's limit", () => {
    let token: string | null = null;
    startAutocapture({ monitoringToken: () => token, behavior: false, preAuthBuffer: 0, maxEvents: 3 });
    for (const path of ["/a", "/b", "/c", "/d", "/e"]) history.pushState({}, "", path);
    expect(sent()).toHaveLength(0);

    token = "token-1";
    for (const path of ["/account", "/orders", "/settings", "/help"]) history.pushState({}, "", path);
    // Five events went nowhere before the sign-in; the three the limit allows are all sent after it.
    expect(sent().map((event) => event.payload!.path)).toEqual(["/account", "/orders", "/settings"]);
  });

  it("counts an event kept for later when it is sent, and one that fell out of the buffer never", () => {
    let token: string | null = null;
    startAutocapture({ monitoringToken: () => token, behavior: false, preAuthBuffer: 2, maxEvents: 4 });
    for (const path of ["/a", "/b", "/c", "/d", "/e"]) history.pushState({}, "", path);

    token = "token-1";
    for (const path of ["/account", "/orders", "/settings"]) history.pushState({}, "", path);
    // The two newest from before the sign-in, then two more: four sent, the limit.
    expect(sent().map((event) => event.payload!.path)).toEqual(["/d", "/e", "/account", "/orders"]);
  });
});

describe("behaviour", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  async function start(): Promise<void> {
    startAutocapture({ monitoringToken: "token-1", pageViews: false });
    // The browser's automation flags are read once, ahead of the first report.
    await jest.advanceTimersByTimeAsync(0);
  }

  function act(type: string, init: MouseEventInit = {}): void {
    document.dispatchEvent(new MouseEvent(type, { bubbles: true, ...init }));
  }

  it("reports a script's perfectly regular, straight-line interaction as numbers", async () => {
    await start();
    for (let step = 0; step < 12; step++) {
      act("pointermove", { clientX: step * 10, clientY: 0 });
      if (step % 2 === 0) act("pointerdown");
      jest.advanceTimersByTime(50);
    }

    hidePage();

    expect(kinds()).toEqual(["session.bot_signal_observed"]);
    expect(sent()[0].payload).toEqual({
      path: "/",
      telemetry_schema_version: 1,
      actions: 6,
      observed_seconds: 1,
      // Six actions in 0.6 s, counted over the one second a rate is measured on at least.
      actions_per_minute: 360,
      timing_variance_ms: 0,
      reaction_time_ms_p50: 100,
      // Dispatched by a script, as these are: a person's input is trusted.
      untrusted_actions: 6,
      pointer_entropy: 0,
      bot_score: 90,
      bot_flags: "webdriver",
    });
  });

  it("tells an irregular rhythm from a regular one, from key press times alone", async () => {
    await start();
    for (const pause of [130, 420, 90, 760, 210, 55, 980, 340, 150, 610]) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
      jest.advanceTimersByTime(pause);
    }

    hidePage();

    const payload = sent()[0].payload!;
    expect(payload.actions).toBe(10);
    expect(payload.timing_variance_ms).toBeGreaterThan(100);
    expect(payload.keystroke_entropy).toBeGreaterThan(1);
    expect(payload).not.toHaveProperty("pointer_entropy");
    // Which keys were pressed is never part of it.
    expect(JSON.stringify(payload)).not.toContain('"s"');
  });

  it("says nothing about a page the person barely touched, and reports each page under its own path", async () => {
    await start();
    act("pointerdown");
    hidePage();
    expect(sent()).toHaveLength(0);

    for (let step = 0; step < 6; step++) {
      act("pointerdown");
      jest.advanceTimersByTime(300);
    }
    history.pushState({}, "", "/checkout");

    expect(kinds()).toEqual(["session.bot_signal_observed"]);
    expect(sent()[0].payload).toMatchObject({ path: "/", actions: 7 });
  });

  it("does not carry a barely-touched page's actions into the next page", async () => {
    await start();
    for (let step = 0; step < 3; step++) {
      act("pointerdown");
      jest.advanceTimersByTime(300);
    }
    history.pushState({}, "", "/checkout");
    for (let step = 0; step < 3; step++) {
      act("pointerdown");
      jest.advanceTimersByTime(300);
    }
    history.pushState({}, "", "/done");
    // Three actions on each page: neither is enough, and they are not six actions of the second.
    expect(sent()).toHaveLength(0);

    for (let step = 0; step < 5; step++) {
      act("pointerdown");
      jest.advanceTimersByTime(300);
    }
    history.pushState({}, "", "/receipt");
    expect(sent()[0].payload).toMatchObject({ path: "/done", actions: 5 });
  });
});

describe("limits and stopping", () => {
  it("stops sending at the session's event limit", () => {
    startAutocapture({ monitoringToken: "token-1", behavior: false, maxEvents: 3 });
    for (const path of ["/a", "/b", "/c", "/d"]) history.pushState({}, "", path);
    expect(sent()).toHaveLength(3);
  });

  it("sends an event of the integrator's own with the session attached, and nothing once stopped", () => {
    const pushState = history.pushState;
    const stop = startAutocapture({ monitoringToken: "token-1", pageViews: false, behavior: false });
    expect(history.pushState).not.toBe(pushState);

    track("security", "device_changed", { changed_field: "device" });
    expect(sent()[0]).toMatchObject({ category: "security", actionType: "device_changed" });
    expect(sent()[0].payload).toEqual({ path: "/", changed_field: "device" });
    expect(sent()[0].session!.sessionId).toMatch(/^[0-9a-f]{32}$/);

    stop();
    expect(history.pushState).toBe(pushState);
    track("auth", "login");
    history.pushState({}, "", "/after");
    expect(sent()).toHaveLength(1);
  });
});

describe("what goes on the wire", () => {
  it("is an event the events API accepts: the session in its own block, the path in the payload", () => {
    startAutocapture({ monitoringToken: "token-1", behavior: false });
    history.pushState({}, "", "/account/security");

    const body = buildEventRequestBody(sent()[2], "event-1");

    expect(body).toMatchObject({
      event_id: "event-1",
      event_category: "session",
      action_type: "page_view",
      session: { sequence: 3, page_url: "http://localhost/account/security" },
      payload: { path: "/account/security", previous_path: "/", seconds_on_previous: 0 },
    });
    expect(typeof (body.session as { session_id: unknown }).session_id).toBe("string");
    expect(typeof body.occurred_at).toBe("string");
  });

  it("gives the device identifiers for an event the integrator's backend sends itself", async () => {
    expect(await getDeviceContext()).toEqual({ persistent_device_id: "pid-1", fingerprint: "hash-1", bot_score: 90 });
  });
});
