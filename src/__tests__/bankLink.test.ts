import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { DiditSdk } from "../DiditSdk";
import { DiditBankLinkError, bankLinkRuntime, buildBankLinkFrameUrl, parseBankLinkToken, readBankLinkEvent } from "../bankLink";
import { BANK_LINK_RESUME_STORAGE_KEY } from "../constants";
import { BANK_LINK_TRANSLATION_LANGUAGES, MODAL_TRANSLATION_LANGUAGES } from "../translations";

const ORIGIN = "https://verify.didit.me";
const TOKEN = "blt_0123456789abcdefghij";

function frame(): HTMLIFrameElement {
  const el = document.querySelector<HTMLIFrameElement>("iframe.didit-verification-iframe");
  if (!el) throw new Error("no frame");
  return el;
}

function send(data: unknown, opts: { origin?: string; source?: Window | null } = {}): void {
  const source = "source" in opts ? opts.source : frame().contentWindow;
  window.dispatchEvent(new MessageEvent("message", { data, origin: opts.origin ?? ORIGIN, source: source as WindowProxy | null }));
}

function msg(name: string, data: unknown = {}, linkRef?: string): unknown {
  return { type: `didit:bank_link:${name}`, v: 1, data, timestamp: 1, ...(linkRef ? { link_ref: linkRef } : {}) };
}

function fragment(): URLSearchParams {
  return new URLSearchParams(new URL(frame().src).hash.slice(1));
}

beforeEach(() => {
  DiditSdk.reset();
  document.body.innerHTML = '<div id="bank"></div>';
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/return");
});

afterEach(() => {
  DiditSdk.reset();
  jest.restoreAllMocks();
});

describe("option validation", () => {
  it("accepts a client token and refuses everything else before any frame exists", () => {
    for (const bad of ["blt_x", "", "bearer abc", "https://evil.example/bank/link/blu_0123456789abcdefghij", undefined, 5]) {
      expect(() => DiditSdk.shared.openBankLink({ token: bad as string })).toThrow(DiditBankLinkError);
    }
    expect(document.querySelector("iframe")).toBeNull();
    try {
      DiditSdk.shared.openBankLink({ token: "blt_short" });
    } catch (error) {
      expect((error as DiditBankLinkError).code).toBe("invalid_token");
      expect((error as Error).message).not.toContain("blt_short");
    }
  });

  it("takes the token of a hosted URL on the Didit origin only", () => {
    expect(parseBankLinkToken(`${ORIGIN}/bank/link/blu_0123456789abcdefghij`, ORIGIN)).toBe("blu_0123456789abcdefghij");
    expect(parseBankLinkToken(`${ORIGIN}/bank/link/#t=blt_0123456789abcdefghij`, ORIGIN)).toBe("blt_0123456789abcdefghij");
    expect(() => parseBankLinkToken("http://verify.didit.me/bank/link/blu_0123456789abcdefghij", ORIGIN)).toThrow();
  });

  it("validates the container, the callbacks, the theme, the locale and baseUrl", () => {
    expect(() => DiditSdk.shared.openBankLink({ token: TOKEN, container: "#missing" })).toThrow(/container/);
    expect(() => DiditSdk.shared.openBankLink({ token: TOKEN, container: 5 as never })).toThrow(DiditBankLinkError);
    expect(() => DiditSdk.shared.openBankLink({ token: TOKEN, onSuccess: "x" as never })).toThrow(/onSuccess/);
    expect(() => DiditSdk.shared.openBankLink({ token: TOKEN, theme: "red" as never })).toThrow(/theme/);
    expect(() => DiditSdk.shared.openBankLink({ token: TOKEN, locale: "<script>" })).toThrow(/locale/);
    expect(() => DiditSdk.shared.openBankLink({ token: TOKEN, baseUrl: "http://example.com" })).toThrow(/https/);
    expect(document.querySelector("iframe")).toBeNull();
  });
});

describe("frame and token", () => {
  it("puts the token in the fragment only, never the path or query, and sets no referrer", () => {
    DiditSdk.shared.openBankLink({ token: TOKEN, locale: "es", theme: "dark" });
    const url = new URL(frame().src);
    expect(url.origin).toBe(ORIGIN);
    expect(url.search).toBe("");
    expect(url.pathname).not.toContain(TOKEN);
    const params = fragment();
    expect(params.get("t")).toBe(TOKEN);
    expect(params.get("parent_origin")).toBe(window.location.origin);
    expect(params.get("v")).toBe("1");
    expect(params.get("presentation")).toBe("modal");
    expect(params.get("locale")).toBe("es");
    expect(params.get("theme")).toBe("dark");
    expect(frame().referrerPolicy).toBe("no-referrer");
    expect(frame().getAttribute("allow")).toBe("clipboard-write");
    expect(window.sessionStorage.length).toBeGreaterThan(0);
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(TOKEN);
  });

  it("renders inline in a container and labels the modal in the link language", () => {
    DiditSdk.shared.openBankLink({ token: TOKEN, container: "#bank" });
    expect(document.querySelector("#bank iframe")).not.toBeNull();
    expect(fragment().get("presentation")).toBe("inline");
    DiditSdk.reset();
    DiditSdk.shared.openBankLink({ token: TOKEN, locale: "es" });
    expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Conexión bancaria Didit");
  });

  it("has modal text for every language the verification modal has", () => {
    expect([...BANK_LINK_TRANSLATION_LANGUAGES].sort()).toEqual([...MODAL_TRANSLATION_LANGUAGES].filter((l) => l !== "en").sort());
  });

  it("builds a resume URL with the code in the fragment", () => {
    const url = buildBankLinkFrameUrl({
      origin: ORIGIN, instanceId: "6e1b8c34-7d02-4f95-a3c6-0b9e5d2a7f18", secret: { resumeCode: "rc_abcdefgh" },
      parentOrigin: "https://app.example.com", presentation: "modal"
    });
    expect(new URL(url).search).toBe("");
    expect(new URLSearchParams(new URL(url).hash.slice(1)).get("resume_code")).toBe("rc_abcdefgh");
  });
});

describe("origin and source checks", () => {
  it("ignores a message from another origin, a look-alike origin or another window", () => {
    const onEvent = jest.fn();
    DiditSdk.shared.openBankLink({ token: TOKEN, onEvent });
    const opened = msg("opened", { link_id: "l1", mode: "connect", access: "ongoing" });
    send(opened, { origin: "https://evil.example" });
    send(opened, { origin: "https://verify.didit.me.evil.example" });
    send(opened, { origin: "https://app.didit.me" });
    send(opened, { source: window });
    send(opened, { source: null });
    expect(onEvent).not.toHaveBeenCalled();
    send(opened);
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("ignores a message from the exact origin when it comes from another instance's frame", () => {
    const onEvent = jest.fn();
    DiditSdk.shared.openBankLink({ token: TOKEN, onEvent });
    const stranger = document.createElement("iframe");
    document.body.appendChild(stranger);
    send(msg("opened", { link_id: "l1", mode: "connect", access: "ongoing" }), { source: stranger.contentWindow });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("drops a wrong protocol version, a wrong prefix and a link_ref that differs from the first one", () => {
    const onEvent = jest.fn();
    DiditSdk.shared.openBankLink({ token: TOKEN, onEvent });
    send({ ...(msg("opened", { link_id: "l1", mode: "connect", access: "ongoing" }) as object), v: 2 });
    send({ ...(msg("opened", { link_id: "l1", mode: "connect", access: "ongoing" }) as object), type: "didit:other:opened" });
    expect(onEvent).not.toHaveBeenCalled();
    send(msg("consent_shown", { link_id: "l1", consent_version: "1" }, "ref-a"));
    send(msg("consent_shown", { link_id: "l1", consent_version: "1" }, "ref-b"));
    send(msg("consent_shown", { link_id: "l1", consent_version: "1" }));
    expect(onEvent).toHaveBeenCalledTimes(1);
  });
});

describe("event mapping", () => {
  it("maps every event name and strips keys outside the allow-list", () => {
    const onEvent = jest.fn();
    DiditSdk.shared.openBankLink({ token: TOKEN, onEvent });
    send(msg("opened", { link_id: "l1", mode: "renew", access: "one_time", presentation: "modal", token: "leak", email: "a@b.c" }));
    send(msg("consent_shown", { link_id: "l1", consent_version: "2" }));
    send(msg("consent_accepted", { link_id: "l1", consent_version: "2" }));
    send(msg("institution_selected", { institution_id: "i1", country: "ESP", name: "Some Bank" }));
    send(msg("bank_redirect", { via: "popup", url: "https://bank.example/x" }));
    send(msg("bank_returned", { result: "ok" }));
    send(msg("accounts_selected", { count: 2 }));
    send(msg("error", { code: "network" }));
    const events = onEvent.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(events.map((e) => e.name)).toEqual([
      "opened", "consent_shown", "consent_accepted", "institution_selected", "bank_redirect", "bank_returned", "accounts_selected", "error"
    ]);
    expect(events[0]).toEqual({ name: "opened", link_id: "l1", mode: "renew", access: "one_time", presentation: "modal" });
    expect(events[3]).toEqual({ name: "institution_selected", institution_id: "i1", country: "ESP" });
    expect(events[4]).toEqual({ name: "bank_redirect", via: "popup" });
    expect(JSON.stringify(events)).not.toMatch(/leak|a@b\.c|Some Bank|bank\.example/);
  });

  it("drops events with a missing or invalid required key and maps unknown error codes", () => {
    expect(readBankLinkEvent("opened", { link_id: "l1", mode: "weird", access: "ongoing" })).toBeNull();
    expect(readBankLinkEvent("accounts_selected", { count: "2" })).toBeNull();
    expect(readBankLinkEvent("nope", {})).toBeNull();
    expect(readBankLinkEvent("error", { code: "Not A Code!" })).toEqual({ name: "error", code: "unknown" });
    expect(readBankLinkEvent("exit", { reason: "closed" })).toEqual({ name: "exit", reason: "closed", step: null });
  });

  it("fires onSuccess once, with the same payload as the success event, and never an exit after it", () => {
    const onSuccess = jest.fn();
    const onExit = jest.fn();
    const onEvent = jest.fn();
    const handle = DiditSdk.shared.openBankLink({ token: TOKEN, onSuccess, onExit, onEvent });
    send(msg("opened", { link_id: "l1", mode: "connect", access: "ongoing" }));
    expect(handle.state).toBe("open");
    send(msg("success", { link_id: "l1", connection_id: "c1", check_id: null }));
    send(msg("success", { link_id: "l1", connection_id: "c2" }));
    send(msg("exit", { reason: "failed", step: "done" }));
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith({ link_id: "l1", connection_id: "c1", check_id: null });
    expect(onExit).not.toHaveBeenCalled();
    send(msg("close_request"));
    expect(onExit).not.toHaveBeenCalled();
    expect(handle.state).toBe("closed");
    expect(document.querySelector("iframe")).toBeNull();
    expect(onEvent.mock.calls.map((c) => (c[0] as { name: string }).name)).toEqual(["opened", "success"]);
  });

  it("fires onExit once for a terminal exit, and for a close request or handle.close()", () => {
    const onExit = jest.fn();
    DiditSdk.shared.openBankLink({ token: TOKEN, onExit });
    send(msg("exit", { reason: "expired", step: "consent" }));
    send(msg("exit", { reason: "failed", step: null }));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith({ reason: "expired", step: "consent" });

    DiditSdk.reset();
    const second = jest.fn();
    const handle = DiditSdk.shared.openBankLink({ token: TOKEN, onExit: second });
    send(msg("opened", { link_id: "l9", mode: "connect", access: "one_time" }));
    handle.close();
    handle.close();
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith({ reason: "closed", step: null, link_id: "l9" });
  });

  it("a host callback that throws does not break the flow", () => {
    const onEvent = jest.fn(() => { throw new Error("host bug"); });
    const onSuccess = jest.fn();
    DiditSdk.shared.openBankLink({ token: TOKEN, onEvent, onSuccess });
    send(msg("success", { link_id: "l1" }));
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("a second openBankLink closes the first with exit closed", () => {
    const first = jest.fn();
    const a = DiditSdk.shared.openBankLink({ token: TOKEN, onExit: first });
    const b = DiditSdk.shared.openBankLink({ token: TOKEN });
    expect(first).toHaveBeenCalledWith({ reason: "closed", step: null });
    expect(a.state).toBe("closed");
    expect(b.state).not.toBe("closed");
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
  });
});

describe("the bank hop", () => {
  function listenToFrame(): jest.Mock {
    const posted = jest.fn();
    jest.spyOn(frame().contentWindow as Window, "postMessage").mockImplementation(posted);
    return posted;
  }

  function fakePopup(): { closed: boolean; close: jest.Mock; location: { href: string }; opener: unknown } {
    return { closed: false, close: jest.fn(), location: { href: "" }, opener: {} };
  }

  it("opens the popup, reports it to the exact origin, navigates it to an https address and reports when it closes", () => {
    jest.useFakeTimers();
    try {
      const onEvent = jest.fn();
      DiditSdk.shared.openBankLink({ token: TOKEN, onEvent });
      const posted = listenToFrame();
      const popup = fakePopup();
      jest.spyOn(bankLinkRuntime, "openPopup").mockReturnValue(popup as unknown as Window);
      send(msg("open_bank", { request_id: "r1" }));
      expect(popup.opener).toBeNull();
      expect(posted.mock.calls[0][0]).toMatchObject({ type: "didit:bank_link:popup_state", v: 1, data: { request_id: "r1", state: "opened" } });
      expect(posted.mock.calls[0][1]).toBe(ORIGIN);
      send(msg("bank_url", { request_id: "other", url: "https://bank.example/auth" }));
      send(msg("bank_url", { request_id: "r1", url: "javascript:alert(1)" }));
      expect(popup.location.href).toBe("");
      send(msg("bank_url", { request_id: "r1", url: "https://bank.example/auth" }));
      expect(popup.location.href).toBe("https://bank.example/auth");
      popup.closed = true;
      jest.advanceTimersByTime(600);
      expect(posted.mock.calls[1][0]).toMatchObject({ data: { request_id: "r1", state: "closed" } });
      expect(onEvent).not.toHaveBeenCalled(); // the bank URL and popup state are never public events
    } finally {
      jest.useRealTimers();
    }
  });

  it("reports blocked and raises error popup_blocked when the browser blocks the popup", () => {
    const onEvent = jest.fn();
    DiditSdk.shared.openBankLink({ token: TOKEN, onEvent });
    const posted = listenToFrame();
    jest.spyOn(bankLinkRuntime, "openPopup").mockReturnValue(null);
    send(msg("open_bank", { request_id: "r1" }));
    expect(posted.mock.calls[0][0]).toMatchObject({ data: { request_id: "r1", state: "blocked" } });
    expect(onEvent).toHaveBeenCalledWith({ name: "error", code: "popup_blocked" });
  });

  it("does not try a popup on a touch-first device", () => {
    DiditSdk.shared.openBankLink({ token: TOKEN });
    const posted = listenToFrame();
    const openPopup = jest.spyOn(bankLinkRuntime, "openPopup");
    window.matchMedia = ((q: string) => ({ matches: q.includes("coarse") })) as never;
    Object.defineProperty(navigator, "maxTouchPoints", { value: 5, configurable: true });
    try {
      send(msg("open_bank", { request_id: "r1" }));
    } finally {
      delete (window as { matchMedia?: unknown }).matchMedia;
      Object.defineProperty(navigator, "maxTouchPoints", { value: 0, configurable: true });
    }
    expect(openPopup).not.toHaveBeenCalled();
    expect(posted.mock.calls[0][0]).toMatchObject({ data: { state: "blocked" } });
  });

  it("redirects the page on a redirect request, stores a record without the token, and reports no exit", () => {
    const navigate = jest.spyOn(bankLinkRuntime, "navigate").mockImplementation(() => undefined);
    const onExit = jest.fn();
    DiditSdk.shared.openBankLink({ token: TOKEN, container: "#bank", onExit });
    send(msg("redirect_request", { request_id: "r1", resume_code: "rc_abcdefgh12" }, "ref-1"));
    expect(navigate).toHaveBeenCalledTimes(1);
    const target = new URL(navigate.mock.calls[0][0]);
    expect(target.origin).toBe(ORIGIN);
    expect(target.pathname).toBe("/bank/link/");
    expect(target.search).toBe("");
    const params = new URLSearchParams(target.hash.slice(1));
    expect(params.get("resume_code")).toBe("rc_abcdefgh12");
    expect(params.get("t")).toBeNull();
    expect(params.get("return")).toBe(`${window.location.origin}/return`);
    const stored = window.sessionStorage.getItem(BANK_LINK_RESUME_STORAGE_KEY) as string;
    expect(JSON.parse(stored)).toMatchObject({ v: 1, link_ref: "ref-1", container: "#bank" });
    expect(stored).not.toContain(TOKEN);
    expect(onExit).not.toHaveBeenCalled();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("continues with the token when the frame gave no resume code", () => {
    const navigate = jest.spyOn(bankLinkRuntime, "navigate").mockImplementation(() => undefined);
    DiditSdk.shared.openBankLink({ token: TOKEN });
    send(msg("redirect_request", { request_id: "r1" }));
    expect(new URLSearchParams(new URL(navigate.mock.calls[0][0]).hash.slice(1)).get("t")).toBe(TOKEN);
  });
});

describe("resumeBankLink", () => {
  const record = (extra: object = {}) =>
    window.sessionStorage.setItem(
      BANK_LINK_RESUME_STORAGE_KEY,
      JSON.stringify({ v: 1, instance_id: "6e1b8c34-7d02-4f95-a3c6-0b9e5d2a7f18", link_ref: null, container: null, ts: Date.now(), ...extra })
    );

  it("does nothing without a record, with an old record, or without a code in the URL", async () => {
    expect(await DiditSdk.shared.resumeBankLink()).toEqual({ resumed: false });
    window.history.replaceState(null, "", "/return?didit_resume=rc_abcdefgh12");
    expect(await DiditSdk.shared.resumeBankLink()).toEqual({ resumed: false });
    record({ ts: Date.now() - 25 * 3600 * 1000 });
    expect(await DiditSdk.shared.resumeBankLink()).toEqual({ resumed: false });
    expect(window.sessionStorage.getItem(BANK_LINK_RESUME_STORAGE_KEY)).toBeNull();
    record();
    window.history.replaceState(null, "", "/return");
    expect(await DiditSdk.shared.resumeBankLink()).toEqual({ resumed: false });
    expect(window.sessionStorage.getItem(BANK_LINK_RESUME_STORAGE_KEY)).not.toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("reopens the flow with the code and instance, strips the code from the URL, and replays a success once", async () => {
    record();
    window.history.replaceState(null, "", "/return?keep=1&didit_resume=rc_abcdefgh12#x");
    const onSuccess = jest.fn();
    const onEvent = jest.fn();
    expect(await DiditSdk.shared.resumeBankLink({ onSuccess, onEvent })).toEqual({ resumed: true });
    expect(window.location.search).toBe("?keep=1");
    expect(window.location.hash).toBe("#x");
    const params = fragment();
    expect(params.get("resume_code")).toBe("rc_abcdefgh12");
    expect(params.get("instance_id")).toBe("6e1b8c34-7d02-4f95-a3c6-0b9e5d2a7f18");
    expect(params.get("t")).toBeNull();
    send(msg("success", { link_id: "l1", connection_id: "c1" }));
    expect(onSuccess).toHaveBeenCalledWith({ link_id: "l1", connection_id: "c1", resumed: true });
    expect(onEvent).toHaveBeenCalledWith({ name: "success", link_id: "l1", connection_id: "c1", resumed: true });
    expect(window.sessionStorage.getItem(BANK_LINK_RESUME_STORAGE_KEY)).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("replays an exit, and keeps the flow on screen while the bank is still being finished", async () => {
    record();
    window.history.replaceState(null, "", "/return?didit_resume=rc_abcdefgh12");
    const onExit = jest.fn();
    await DiditSdk.shared.resumeBankLink({ onExit });
    send(msg("bank_returned", { result: "ok" }));
    expect(document.querySelector("iframe")).not.toBeNull();
    send(msg("exit", { reason: "cancelled", step: "bank_hop" }));
    expect(onExit).toHaveBeenCalledWith({ reason: "cancelled", step: "bank_hop", resumed: true });
    expect(document.querySelector("iframe")).toBeNull();
  });
});
