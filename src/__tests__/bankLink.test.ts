import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import type { BankLinkHandle } from "../types";
import { DiditSdk } from "../DiditSdk";
import { DiditBankLinkError, bankLinkRuntime, buildBankLinkFrameUrl, parseBankLinkToken, readBankLinkEvent } from "../bankLink";
import { BANK_LINK_RESUME_STORAGE_KEY } from "../constants";
import { BANK_LINK_TRANSLATION_LANGUAGES, MODAL_TRANSLATION_LANGUAGES, getBankLinkModalTranslations } from "../translations";
import { BANK_LINK_FRAME_LOAD_TIMEOUT_MS } from "../constants";

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

const FRAME_ID = "frame_0123456789ab";
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Opens a link and waits for the frame-policy answer (the default one allows this page). */
async function open(options: Parameters<typeof DiditSdk.shared.openBankLink>[0]): Promise<BankLinkHandle> {
  const handle = DiditSdk.shared.openBankLink(options);
  await flush();
  return handle;
}

function fragment(): URLSearchParams {
  return new URLSearchParams(new URL(frame().src).hash.slice(1));
}

beforeEach(() => {
  jest.spyOn(bankLinkRuntime, "fetchPolicy").mockResolvedValue({
    valid: true,
    frame_id: FRAME_ID,
    allowed_origins: [window.location.origin]
  });
  DiditSdk.reset();
  document.body.innerHTML = '<div id="bank"></div>';
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/return");
});

afterEach(() => {
  DiditSdk.reset();
  jest.restoreAllMocks();
});

describe("return URL", () => {
  it("sends the page's own address without its fragment and without a leftover resume code", async () => {
    const navigate = jest.spyOn(bankLinkRuntime, "navigate").mockImplementation(() => undefined);
    window.history.replaceState(null, "", "/app?x=1&didit_resume=rsc_old0001.0123456789abcdef#/checkout");
    await open({ token: TOKEN });
    send(msg("redirect_request", { request_id: "r1", resume_code: "rsc_abcdef0123456789.0123456789abcdef" }));
    const params = new URLSearchParams(new URL(navigate.mock.calls[0][0]).hash.slice(1));
    expect(params.get("return")).toBe(`${window.location.origin}/app?x=1`);
  });
});

describe("option validation", () => {
  it("accepts a client token and refuses everything else before any frame exists", async () => {
    for (const bad of ["blt_x", "", "bearer abc", "https://evil.example/bank/link/blu_0123456789abcdefghij", undefined, 5]) {
      expect(() => DiditSdk.shared.openBankLink({ token: bad as string })).toThrow(DiditBankLinkError);
    }
    expect(document.querySelector("iframe")).toBeNull();
    try {
      await open({ token: "blt_short" });
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
  it("puts the token in the fragment only, never the path or query, and sets no referrer", async () => {
    await open({ token: TOKEN, locale: "es", theme: "dark" });
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

  it("renders inline in a container and labels the modal in the link language", async () => {
    await open({ token: TOKEN, container: "#bank" });
    expect(document.querySelector("#bank iframe")).not.toBeNull();
    expect(fragment().get("presentation")).toBe("inline");
    DiditSdk.reset();
    await open({ token: TOKEN, locale: "es" });
    expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Conexión bancaria Didit");
  });

  it("has modal text for every language the verification modal has", () => {
    expect([...BANK_LINK_TRANSLATION_LANGUAGES].sort()).toEqual([...MODAL_TRANSLATION_LANGUAGES].filter((l) => l !== "en").sort());
  });

  it("has the load-error text and the retry label in every language", () => {
    for (const language of BANK_LINK_TRANSLATION_LANGUAGES) {
      const t = getBankLinkModalTranslations(language);
      expect([language, (t.loadErrorMessage ?? "").length > 10, (t.retryButton ?? "").length > 0]).toEqual([language, true, true]);
      expect([language, (t.refusalMessage ?? "").length > 10, (t.closeButton ?? "").length > 0]).toEqual([language, true, true]);
    }
  });

  it("builds a resume URL with the code in the fragment", () => {
    const url = buildBankLinkFrameUrl({
      origin: ORIGIN, framePath: FRAME_ID, instanceId: "6e1b8c34-7d02-4f95-a3c6-0b9e5d2a7f18", secret: { resumeCode: "rc_abcdefgh" },
      parentOrigin: "https://app.example.com", presentation: "modal"
    });
    expect(new URL(url).search).toBe("");
    expect(new URLSearchParams(new URL(url).hash.slice(1)).get("resume_code")).toBe("rc_abcdefgh");
  });
});

describe("origin and source checks", () => {
  it("ignores a message from another origin, a look-alike origin or another window", async () => {
    const onEvent = jest.fn();
    await open({ token: TOKEN, onEvent });
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

  it("ignores a message from the exact origin when it comes from another instance's frame", async () => {
    const onEvent = jest.fn();
    await open({ token: TOKEN, onEvent });
    const stranger = document.createElement("iframe");
    document.body.appendChild(stranger);
    send(msg("opened", { link_id: "l1", mode: "connect", access: "ongoing" }), { source: stranger.contentWindow });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("drops a wrong protocol version, a wrong prefix and a link_ref that differs from the first one", async () => {
    const onEvent = jest.fn();
    await open({ token: TOKEN, onEvent });
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
  it("maps every event name and strips keys outside the allow-list", async () => {
    const onEvent = jest.fn();
    await open({ token: TOKEN, onEvent });
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

  it("fires onSuccess once, with the same payload as the success event, and never an exit after it", async () => {
    const onSuccess = jest.fn();
    const onExit = jest.fn();
    const onEvent = jest.fn();
    const handle = await open({ token: TOKEN, onSuccess, onExit, onEvent });
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

  it("fires onExit once for a terminal exit, and for a close request or handle.close()", async () => {
    const onExit = jest.fn();
    await open({ token: TOKEN, onExit });
    send(msg("exit", { reason: "expired", step: "consent" }));
    send(msg("exit", { reason: "failed", step: null }));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith({ reason: "expired", step: "consent" });

    DiditSdk.reset();
    const second = jest.fn();
    const handle = await open({ token: TOKEN, onExit: second });
    send(msg("opened", { link_id: "l9", mode: "connect", access: "one_time" }));
    handle.close();
    handle.close();
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith({ reason: "closed", step: null, link_id: "l9" });
  });

  it("a host callback that throws does not break the flow", async () => {
    const onEvent = jest.fn(() => { throw new Error("host bug"); });
    const onSuccess = jest.fn();
    await open({ token: TOKEN, onEvent, onSuccess });
    send(msg("success", { link_id: "l1" }));
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("a second openBankLink closes the first with exit closed", async () => {
    const first = jest.fn();
    const a = await open({ token: TOKEN, onExit: first });
    const b = await open({ token: TOKEN });
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

  it("opens the popup, reports it to the exact origin, navigates it to an https address and reports when it closes", async () => {
    const onEvent = jest.fn();
    await open({ token: TOKEN, onEvent });
    jest.useFakeTimers();
    try {
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

  it("reports blocked and raises error popup_blocked when the browser blocks the popup", async () => {
    const onEvent = jest.fn();
    await open({ token: TOKEN, onEvent });
    const posted = listenToFrame();
    jest.spyOn(bankLinkRuntime, "openPopup").mockReturnValue(null);
    send(msg("open_bank", { request_id: "r1" }));
    expect(posted.mock.calls[0][0]).toMatchObject({ data: { request_id: "r1", state: "blocked" } });
    expect(onEvent).toHaveBeenCalledWith({ name: "error", code: "popup_blocked" });
  });

  it("does not try a popup on a touch-first device", async () => {
    await open({ token: TOKEN });
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

  it("redirects the page on a redirect request, stores a record without the token, and reports no exit", async () => {
    const navigate = jest.spyOn(bankLinkRuntime, "navigate").mockImplementation(() => undefined);
    const onExit = jest.fn();
    await open({ token: TOKEN, container: "#bank", onExit });
    send(msg("redirect_request", { request_id: "r1", resume_code: "rc_abcdefgh12" }, "ref-1"));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0][0]).not.toContain("resume=");
    const target = new URL(navigate.mock.calls[0][0]);
    expect(target.origin).toBe(ORIGIN);
    expect(target.pathname).toBe("/bank/link/");
    expect(target.search).toBe("");
    const params = new URLSearchParams(target.hash.slice(1));
    expect(params.get("resume_code")).toBe("rc_abcdefgh12");
    expect(params.get("t")).toBeNull();
    expect(params.has("resume")).toBe(false);
    expect(params.get("return")).toBe(`${window.location.origin}/return`);
    const stored = window.sessionStorage.getItem(BANK_LINK_RESUME_STORAGE_KEY) as string;
    expect(JSON.parse(stored)).toMatchObject({ v: 1, link_ref: "ref-1", container: "#bank", return_to: `${window.location.origin}/return` });
    expect(JSON.parse(stored).instance_id).toBe(params.get("instance_id"));
    expect(stored).not.toContain(TOKEN);
    expect(onExit).not.toHaveBeenCalled();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("never uses the token: a redirect request without a usable resume code goes nowhere", async () => {
    const navigate = jest.spyOn(bankLinkRuntime, "navigate").mockImplementation(() => undefined);
    await open({ token: TOKEN });
    send(msg("redirect_request", { request_id: "r1" }));
    send(msg("redirect_request", { request_id: "r2", resume_code: "has a space" }));
    expect(navigate).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(BANK_LINK_RESUME_STORAGE_KEY)).toBeNull();
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

describe("resumeBankLink with the backend's resume codes and invalid options", () => {
  const record = () =>
    window.sessionStorage.setItem(
      BANK_LINK_RESUME_STORAGE_KEY,
      JSON.stringify({ v: 1, instance_id: "6e1b8c34-7d02-4f95-a3c6-0b9e5d2a7f18", link_ref: null, container: null, ts: Date.now() })
    );
  const DOTTED = "rsc_0123456789abcdef.Zm9vYmFyLWJhei1zZWNyZXQ_~x";

  it("continues with a dotted code (rsc_<id>.<secret>) and sends it unchanged", async () => {
    record();
    window.history.replaceState(null, "", `/return?didit_resume=${encodeURIComponent(DOTTED)}`);
    expect(await DiditSdk.shared.resumeBankLink()).toEqual({ resumed: true });
    expect(window.location.search).toBe("");
    expect(fragment().get("resume_code")).toBe(DOTTED);
    expect(jest.spyOn(bankLinkRuntime, "fetchPolicy").mock.calls[0][1]).toEqual({ resume_code: DOTTED });
  });

  it("still refuses a code with characters outside RFC 3986 unreserved ones, and a code that is too short", async () => {
    record();
    for (const bad of ["rsc_abc def.ghijklmn", "rsc_abc/def.ghijklmn", "a.b", "x".repeat(257)]) {
      window.history.replaceState(null, "", `/return?didit_resume=${encodeURIComponent(bad)}`);
      expect(await DiditSdk.shared.resumeBankLink()).toEqual({ resumed: false });
      expect(document.querySelector("iframe")).toBeNull();
    }
  });

  it("an invalid option throws and leaves the code in the address; the corrected call still resumes", async () => {
    record();
    window.history.replaceState(null, "", `/return?keep=1&didit_resume=${encodeURIComponent(DOTTED)}#x`);
    for (const bad of [{ apiBaseUrl: "not a url" }, { baseUrl: "http://insecure.example" }, { onSuccess: "nope" as never }, { theme: "blue" as never }]) {
      await expect(DiditSdk.shared.resumeBankLink(bad)).rejects.toMatchObject({ code: "invalid_options" });
      expect(window.location.search).toBe(`?keep=1&didit_resume=${encodeURIComponent(DOTTED)}`);
      expect(window.location.hash).toBe("#x");
      expect(window.sessionStorage.getItem(BANK_LINK_RESUME_STORAGE_KEY)).not.toBeNull();
      expect(document.querySelector("iframe")).toBeNull();
    }
    expect(await DiditSdk.shared.resumeBankLink()).toEqual({ resumed: true });
    expect(window.location.search).toBe("?keep=1");
    expect(fragment().get("resume_code")).toBe(DOTTED);
  });
});

describe("frame policy for a resume", () => {
  const record = () =>
    window.sessionStorage.setItem(
      BANK_LINK_RESUME_STORAGE_KEY,
      JSON.stringify({ v: 1, instance_id: "6e1b8c34-7d02-4f95-a3c6-0b9e5d2a7f18", link_ref: null, container: null, ts: Date.now() })
    );

  it("asks with the resume code, then loads the frame at the answered frame_id with the code in the fragment", async () => {
    record();
    window.history.replaceState(null, "", "/return?didit_resume=rc_abcdefgh12");
    await DiditSdk.shared.resumeBankLink();
    await flush();
    const [url, body] = jest.spyOn(bankLinkRuntime, "fetchPolicy").mock.calls[0];
    expect(url).toBe("https://verification.didit.me/v3/bank/link-session/frame-policy/");
    expect(body).toEqual({ resume_code: "rc_abcdefgh12" });
    expect(new URL(frame().src).pathname).toBe(`/bank/frame/${FRAME_ID}`);
    expect(fragment().get("resume_code")).toBe("rc_abcdefgh12");
    expect(fragment().get("instance_id")).toBe("6e1b8c34-7d02-4f95-a3c6-0b9e5d2a7f18");
  });

  it("applies the same refusals: invalid code, origin not allowed, network", async () => {
    const cases: Array<[() => void, unknown[]]> = [
      [() => jest.spyOn(bankLinkRuntime, "fetchPolicy").mockResolvedValue({ valid: false }),
        [{ name: "error", code: "invalid_token" }, { name: "exit", reason: "not_allowed", step: null }]],
      [() => jest.spyOn(bankLinkRuntime, "fetchPolicy").mockResolvedValue({ valid: true, frame_id: FRAME_ID, allowed_origins: ["https://other.example"] }),
        [{ name: "error", code: "origin_not_allowed" }, { name: "exit", reason: "not_allowed", step: null }]],
      [() => jest.spyOn(bankLinkRuntime, "fetchPolicy").mockRejectedValue(new Error("offline")),
        [{ name: "error", code: "network" }, { name: "exit", reason: "failed", step: null }]]
    ];
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const [arrange, expected] of cases) {
      DiditSdk.reset();
      record();
      window.history.replaceState(null, "", "/return?didit_resume=rc_abcdefgh12");
      arrange();
      const onEvent = jest.fn();
      await DiditSdk.shared.resumeBankLink({ onEvent });
      await flush();
      expect(document.querySelector("iframe")).toBeNull();
      expect(onEvent.mock.calls.map((c) => c[0])).toEqual(expected);
    }
  });
});

describe("frame policy", () => {
  const policy = () => jest.spyOn(bankLinkRuntime, "fetchPolicy");

  it("asks the API with the token, then loads the frame at the answered frame_id, in state opening until opened", async () => {
    const handle = await open({ token: TOKEN });
    expect(policy()).toHaveBeenCalledTimes(1);
    const [url, body] = policy().mock.calls[0];
    expect(url).toBe("https://verification.didit.me/v3/bank/link-session/frame-policy/");
    expect(body).toEqual({ token: TOKEN });
    const src = new URL(frame().src);
    expect(src.pathname).toBe(`/bank/frame/${FRAME_ID}`);
    expect(fragment().get("t")).toBe(TOKEN);
    expect(fragment().get("instance_id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(handle.state).toBe("opening");
    send(msg("opened", { link_id: "l1", mode: "connect", access: "ongoing" }));
    expect(handle.state).toBe("open");
  });

  it("uses apiBaseUrl for the call and validates it", async () => {
    await open({ token: TOKEN, apiBaseUrl: "https://api.example.test/" });
    expect(policy().mock.calls[0][0]).toBe("https://api.example.test/v3/bank/link-session/frame-policy/");
    expect(() => DiditSdk.shared.openBankLink({ token: TOKEN, apiBaseUrl: "http://api.example.test" })).toThrow(/apiBaseUrl/);
  });

  it("opens no frame for an invalid token: error invalid_token, then exit not_allowed", async () => {
    policy().mockResolvedValue({ valid: false });
    const onEvent = jest.fn();
    const onExit = jest.fn();
    const handle = await open({ token: TOKEN, onEvent, onExit });
    expect(document.querySelector("iframe")).toBeNull();
    expect(onEvent.mock.calls.map((c) => c[0])).toEqual([
      { name: "error", code: "invalid_token" },
      { name: "exit", reason: "not_allowed", step: null }
    ]);
    expect(onExit).toHaveBeenCalledWith({ reason: "not_allowed", step: null });
    expect(handle.state).toBe("closed");
  });

  it("opens no frame when this page's origin is not allowed, and warns the developer once with the origin", async () => {
    policy().mockResolvedValue({ valid: true, frame_id: FRAME_ID, allowed_origins: ["https://other.example"] });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const onEvent = jest.fn();
    const onExit = jest.fn();
    await open({ token: TOKEN, onEvent, onExit });
    expect(document.querySelector("iframe")).toBeNull();
    expect(onEvent.mock.calls.map((c) => (c[0] as { code?: string }).code ?? "exit")).toEqual(["origin_not_allowed", "exit"]);
    expect(onExit).toHaveBeenCalledWith({ reason: "not_allowed", step: null });
    expect(warn).toHaveBeenCalledTimes(1);
    const text = String(warn.mock.calls[0][0]);
    expect(text).toContain(window.location.origin);
    expect(text).toContain("allowed_origins");
    expect(text).not.toContain(TOKEN);
  });

  it("ends with error network and exit on a failed call or a timeout", async () => {
    for (const failure of [
      () => policy().mockRejectedValue(new Error("offline")),
      () => policy().mockRejectedValue(new DOMException("aborted", "AbortError"))
    ]) {
      DiditSdk.reset();
      failure();
      const onEvent = jest.fn();
      const handle = await open({ token: TOKEN, onEvent });
      expect(document.querySelector("iframe")).toBeNull();
      expect(onEvent.mock.calls.map((c) => c[0])).toEqual([
        { name: "error", code: "network" },
        { name: "exit", reason: "failed", step: null }
      ]);
      expect(handle.state).toBe("closed");
    }
  });

  it("an answer the SDK cannot use is not a network failure: error unknown, then exit failed, no frame", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const failure of [
      () => policy().mockResolvedValue({ valid: true, frame_id: "../x", allowed_origins: [window.location.origin] }),
      () => policy().mockResolvedValue({ valid: true, frame_id: "frm_0123456789abcdef.12.abcdef", allowed_origins: [window.location.origin] }),
      () => policy().mockResolvedValue("nope"),
      () => policy().mockResolvedValue(undefined)
    ]) {
      DiditSdk.reset();
      failure();
      const onEvent = jest.fn();
      const handle = await open({ token: TOKEN, onEvent });
      expect(document.querySelector("iframe")).toBeNull();
      expect(onEvent.mock.calls.map((c) => c[0])).toEqual([
        { name: "error", code: "unknown" },
        { name: "exit", reason: "failed", step: null }
      ]);
      expect(handle.state).toBe("closed");
    }
  });

  it("accepts the frame id shape the backend mints: frm_<32 hex>-<digits>-<hex>", async () => {
    const minted = "frm_0123456789abcdef0123456789abcdef-1763800000-9f8e7d6c";
    policy().mockResolvedValue({ valid: true, frame_id: minted, allowed_origins: [window.location.origin] });
    await open({ token: TOKEN });
    expect(new URL(frame().src).pathname).toBe(`/bank/frame/${minted}`);
  });

  it("aborts the call and shows nothing when the host closes before the answer", async () => {
    let release: (value: unknown) => void = () => undefined;
    let signal: AbortSignal | undefined;
    policy().mockImplementation((_url, _token, s) => {
      signal = s;
      return new Promise((resolve) => { release = resolve; });
    });
    const onExit = jest.fn();
    const handle = DiditSdk.shared.openBankLink({ token: TOKEN, onExit });
    expect(handle.state).toBe("opening");
    handle.close();
    expect(signal?.aborted).toBe(true);
    release({ valid: true, frame_id: FRAME_ID, allowed_origins: [window.location.origin] });
    await flush();
    expect(document.querySelector("iframe")).toBeNull();
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith({ reason: "closed", step: null });
  });

  it("sends no credentials: the default call is JSON only, without cookies or a referrer", async () => {
    const calls: RequestInit[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      calls.push(init);
      return { ok: true, json: async () => ({ valid: false }) };
    }) as never;
    try {
      jest.restoreAllMocks();
      DiditSdk.shared.openBankLink({ token: TOKEN });
      await flush();
    } finally {
      globalThis.fetch = real;
    }
    expect(calls[0].credentials).toBe("omit");
    expect(calls[0].referrerPolicy).toBe("no-referrer");
    expect(calls[0].headers).toEqual({ "Content-Type": "application/json" });
    expect(calls[0].body).toBe(JSON.stringify({ token: TOKEN }));
  });
});

/**
 * The backend's identifier formats: `formats.json` is a copy of
 * `docs/bank-data/link-contract/formats.json` of the backend repository, pull request branch
 * `fix/bank-redirect-handoff` at commit cae8b37ce82d28ad59b6004992bda05bae7bc4a8 (with `addresses`);
 * `bank-link-resume-code-after-bank.json` is its fixture `resume/code_after_bank.json`. The SDK may be looser than
 * the file (it treats codes as opaque), never stricter.
 */
describe("the backend's identifier formats", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const file = JSON.parse(readFileSync(`${process.cwd()}/src/__tests__/fixtures/bank-link-formats.json`, "utf8")) as {
    formats: Array<{ name: string; pattern: string; example: string }>;
  };
  const format = (name: string) => {
    const found = file.formats.find((f) => f.name === name);
    if (!found) throw new Error(`no format ${name}`);
    expect(new RegExp(found.pattern).test(found.example)).toBe(true);
    return found;
  };
  const record = (instanceId = "6e1b8c34-7d02-4f95-a3c6-0b9e5d2a7f18") =>
    window.sessionStorage.setItem(
      BANK_LINK_RESUME_STORAGE_KEY,
      JSON.stringify({ v: 1, instance_id: instanceId, link_ref: null, container: null, ts: Date.now() })
    );

  it("accepts every example the SDK validates, and refuses values outside the family", async () => {
    // client_token and url_token
    expect(parseBankLinkToken(format("client_token").example, ORIGIN)).toBe(format("client_token").example);
    const urlToken = format("url_token").example;
    expect(parseBankLinkToken(`${ORIGIN}/bank/link/${urlToken}`, ORIGIN)).toBe(urlToken);
    expect(parseBankLinkToken(`${ORIGIN}/bank/link/#t=${urlToken}`, ORIGIN)).toBe(urlToken);
    for (const bad of ["blx_Hs8Pa4Rb6Ye0Gf2Jc7Qm3", "blt_short", "blt_has space_0123456789abcd"]) {
      expect(() => parseBankLinkToken(bad, ORIGIN)).toThrow(DiditBankLinkError);
    }

    // frame_id: loaded at the path of the answer
    const frameId = format("frame_id").example;
    jest.spyOn(bankLinkRuntime, "fetchPolicy").mockResolvedValue({ valid: true, frame_id: frameId, allowed_origins: [window.location.origin] });
    await open({ token: format("client_token").example });
    expect(new URL(frame().src).pathname).toBe(`/bank/frame/${frameId}`);
    DiditSdk.reset();

    // resume_code and instance_id: a resume with both examples
    const code = format("resume_code").example;
    const instanceId = format("instance_id").example;
    record(instanceId);
    window.history.replaceState(null, "", `/return?didit_resume=${encodeURIComponent(code)}`);
    expect(await DiditSdk.shared.resumeBankLink()).toEqual({ resumed: true });
    expect(fragment().get("resume_code")).toBe(code);
    expect(fragment().get("instance_id")).toBe(instanceId);
    DiditSdk.reset();
    record();
    window.history.replaceState(null, "", "/return?didit_resume=rsc_has%20space.0123456789abcdef");
    expect(await DiditSdk.shared.resumeBankLink()).toEqual({ resumed: false });

    // error_code and link_ref
    const errorCode = format("error_code").example;
    expect(readBankLinkEvent("error", { code: errorCode })).toEqual({ name: "error", code: errorCode });
    expect(readBankLinkEvent("error", { code: "Not_A_Code" })).toEqual({ name: "error", code: "unknown" });
    DiditSdk.reset();
    await open({ token: format("client_token").example });
    const linkRef = format("link_ref").example;
    const onEvent = jest.fn();
    DiditSdk.reset();
    await open({ token: format("client_token").example, onEvent });
    send(msg("opened", { link_id: format("link_id").example, mode: "connect", access: "ongoing", presentation: "modal" }, linkRef));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ name: "opened", link_id: format("link_id").example }));
  });
});

describe("exit carries the link id and the last known step", () => {
  const LINK = "11111111-1111-4111-8111-111111111111";

  it("a close from the frame reports the step and link id the frame said, and focus returns to the opener", async () => {
    const opener = document.body.appendChild(document.createElement("button"));
    opener.focus();
    const onExit = jest.fn();
    await open({ token: TOKEN, onExit });
    send(msg("opened", { link_id: LINK, mode: "connect", access: "ongoing" }));
    send(msg("close_request", { step: "segment" }));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith({ reason: "closed", step: "segment", link_id: LINK });
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("close_request ends the flow exactly as the host's handle.close() does", async () => {
    const fromFrame = jest.fn();
    await open({ token: TOKEN, onExit: fromFrame });
    send(msg("opened", { link_id: LINK, mode: "connect", access: "ongoing" }));
    send(msg("step", { step: "consent" }));
    send(msg("close_request"));
    DiditSdk.reset();
    const fromHost = jest.fn();
    const handle = await open({ token: TOKEN, onExit: fromHost });
    send(msg("opened", { link_id: LINK, mode: "connect", access: "ongoing" }));
    send(msg("step", { step: "consent" }));
    handle.close();
    expect(fromFrame.mock.calls).toEqual(fromHost.mock.calls);
    expect(fromFrame).toHaveBeenCalledWith({ reason: "closed", step: "consent", link_id: LINK });
  });

  it("the link id is learned from any message, and a frame exit without a step gets the last known one", async () => {
    const onExit = jest.fn();
    await open({ token: TOKEN, onExit });
    send(msg("step", { step: "institution", link_id: LINK }));
    send(msg("exit", { reason: "cancelled" }));
    expect(onExit).toHaveBeenCalledWith({ reason: "cancelled", step: "institution", link_id: LINK });
  });

  it("before any step is known the step stays null", async () => {
    const onExit = jest.fn();
    const handle = await open({ token: TOKEN, onExit });
    handle.close();
    expect(onExit).toHaveBeenCalledWith({ reason: "closed", step: null });
  });

  it("refuses an invalid height or maxHeight before anything is shown", () => {
    for (const bad of [{ height: 0 }, { height: "" }, { maxHeight: -1 }, { maxHeight: "9" as never }]) {
      expect(() => DiditSdk.shared.openBankLink({ token: TOKEN, ...bad })).toThrow(DiditBankLinkError);
    }
  });
});

describe("the full-page hand-off matches the contract's addresses", () => {
  const formats = JSON.parse(readFileSync(`${process.cwd()}/src/__tests__/fixtures/bank-link-formats.json`, "utf8")) as {
    formats: Array<{ name: string; pattern: string }>;
    addresses: Array<{ name: string; where: string; params: Array<{ name: string; required: boolean; format?: string; pattern?: string }> }>;
  };
  const afterBank = JSON.parse(readFileSync(`${process.cwd()}/src/__tests__/fixtures/bank-link-resume-code-after-bank.json`, "utf8")) as {
    resume_code: string;
  };
  const address = (name: string) => formats.addresses.find((a) => a.name === name)!;
  const patternOf = (param: { format?: string; pattern?: string }) =>
    new RegExp(param.pattern ?? formats.formats.find((f) => f.name === param.format)!.pattern);

  it("sends only the sdk_handoff parameters, in the fragment, with every required one valid", async () => {
    const navigate = jest.spyOn(bankLinkRuntime, "navigate").mockImplementation(() => undefined);
    window.history.replaceState(null, "", "/accounts/connect");
    await open({ token: TOKEN, locale: "es", theme: "dark" });
    send(msg("redirect_request", { request_id: "r1", resume_code: afterBank.resume_code }));
    const target = new URL(navigate.mock.calls[0][0]);
    expect(target.pathname).toBe("/bank/link/");
    expect(target.search).toBe("");
    const sent = new URLSearchParams(target.hash.slice(1));
    const spec = address("sdk_handoff");
    expect(spec.where).toBe("fragment");
    expect([...sent.keys()].every((key) => spec.params.some((p) => p.name === key))).toBe(true);
    for (const param of spec.params) {
      if (param.required) expect([param.name, sent.has(param.name)]).toEqual([param.name, true]);
      if (sent.has(param.name)) expect([param.name, patternOf(param).test(sent.get(param.name) as string)]).toEqual([param.name, true]);
    }
    expect(sent.get("resume_code")).toBe(afterBank.resume_code);
  });

  it("resumes with the code of the hosted_return address, exchanged through the frame with the stored instance", async () => {
    const spec = address("hosted_return");
    expect(spec.where).toBe("query");
    const name = spec.params[0].name;
    expect(patternOf(spec.params[0]).test(afterBank.resume_code)).toBe(true);
    window.sessionStorage.setItem(
      BANK_LINK_RESUME_STORAGE_KEY,
      JSON.stringify({ v: 1, instance_id: "7b1d6a52-3c84-4e0f-9a21-5d8e3f6c0b19", link_ref: null, container: null, ts: Date.now() })
    );
    window.history.replaceState(null, "", `/accounts/connect?${name}=${encodeURIComponent(afterBank.resume_code)}`);
    expect(await DiditSdk.shared.resumeBankLink()).toEqual({ resumed: true });
    expect(window.location.search).toBe("");
    expect(fragment().get("resume_code")).toBe(afterBank.resume_code);
    expect(fragment().get("instance_id")).toBe("7b1d6a52-3c84-4e0f-9a21-5d8e3f6c0b19");
  });
});

describe("the last known step comes from every message the frame posts", () => {
  const LINK = "11111111-1111-4111-8111-111111111111";
  const layout = (step: string | null, where: "data" | "top" = "data") =>
    where === "data"
      ? { type: "didit:layout", data: { contentHeight: 640, kind: "step", step, link_id: LINK }, timestamp: 1 }
      : { type: "didit:layout", data: { contentHeight: 640, kind: "step" }, step, link_id: LINK, timestamp: 1 };
  const opened = () => msg("opened", { link_id: LINK, mode: "connect", access: "ongoing" });

  const sequences: Array<[string, () => void, string]> = [
    ["entry", () => { send(opened()); send(layout(null)); send(layout("consent")); }, "consent"],
    ["consent", () => { send(opened()); send(layout("consent")); send(msg("consent_shown", { link_id: LINK, consent_version: "v1" })); }, "consent"],
    ["segment", () => { send(opened()); send(layout("consent")); send(layout("segment")); }, "segment"],
    ["picker", () => { send(opened()); send(layout("consent")); send(layout("segment")); send(layout("institution", "top")); }, "institution"]
  ];

  it.each(sequences)("%s: the exit reports the frame's last step and the link id, whoever closes", async (_name, replay, expected) => {
    for (const closer of ["handle", "close_request"] as const) {
      DiditSdk.reset();
      const onExit = jest.fn();
      const handle = await open({ token: TOKEN, onExit });
      replay();
      if (closer === "handle") handle.close();
      else send(msg("close_request"));
      expect(onExit).toHaveBeenCalledTimes(1);
      expect(onExit).toHaveBeenCalledWith({ reason: "closed", step: expected, link_id: LINK });
    }
  });

  it("a message without a step (or with a null one) never erases a known step", async () => {
    const onExit = jest.fn();
    const handle = await open({ token: TOKEN, onExit });
    send(opened());
    send(layout("segment"));
    send(layout(null));
    send({ type: "didit:ready", timestamp: 1 });
    send(msg("bank_returned", { result: "ok" }));
    handle.close();
    expect(onExit).toHaveBeenCalledWith({ reason: "closed", step: "segment", link_id: LINK });
  });

  it("a message of another link (a different link_ref) records no step and no link id", async () => {
    const onExit = jest.fn();
    const handle = await open({ token: TOKEN, onExit });
    send(msg("opened", { link_id: LINK, mode: "connect", access: "ongoing" }, "ref-mine"));
    send(msg("step", { step: "consent" }, "ref-mine"));
    send(msg("step", { step: "institution", link_id: "99999999-9999-4999-8999-999999999999" }, "ref-other"));
    send({ type: "didit:layout", data: { contentHeight: 640, step: "accounts" }, link_ref: "ref-other", timestamp: 1 });
    handle.close();
    expect(onExit).toHaveBeenCalledWith({ reason: "closed", step: "consent", link_id: LINK });
  });
});

describe("a frame that never loads", () => {
  const LINK = "11111111-1111-4111-8111-111111111111";
  const card = () => document.querySelector<HTMLElement>(".didit-load-error");
  const retryButton = () => card()?.querySelector("button") as HTMLButtonElement;
  const policy = () => jest.spyOn(bankLinkRuntime, "fetchPolicy");

  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  async function openLink(options: Parameters<typeof DiditSdk.shared.openBankLink>[0]): Promise<BankLinkHandle> {
    const handle = DiditSdk.shared.openBankLink(options);
    await jest.advanceTimersByTimeAsync(0);
    return handle;
  }

  it("waits 25 s, then reports one network error, removes the frame and offers a retry", async () => {
    const onEvent = jest.fn();
    const handle = await openLink({ token: TOKEN, onEvent });
    expect(BANK_LINK_FRAME_LOAD_TIMEOUT_MS).toBe(25000);
    await jest.advanceTimersByTimeAsync(BANK_LINK_FRAME_LOAD_TIMEOUT_MS - 1);
    expect(onEvent).not.toHaveBeenCalled();
    expect(card()).toBeNull();
    await jest.advanceTimersByTimeAsync(1);
    expect(onEvent.mock.calls.map((c) => c[0])).toEqual([{ name: "error", code: "network" }]);
    expect(frame().src).toBe("about:blank");
    expect(frame().style.display).toBe("none");
    expect(card()?.textContent).toContain("couldn't load");
    expect(document.activeElement).toBe(retryButton());
    expect(handle.state).toBe("opening");
    await jest.advanceTimersByTimeAsync(10 * BANK_LINK_FRAME_LOAD_TIMEOUT_MS);
    expect(onEvent).toHaveBeenCalledTimes(1); // no double error
  });

  it("the frame's first message cancels the wait, whether a Bank Link event or a layout message", async () => {
    for (const first of [msg("opened", { link_id: LINK, mode: "connect", access: "ongoing" }), { type: "didit:layout", data: { contentHeight: 600 }, timestamp: 1 }]) {
      DiditSdk.reset();
      const onEvent = jest.fn();
      await openLink({ token: TOKEN, onEvent });
      await jest.advanceTimersByTimeAsync(5000);
      send(first);
      await jest.advanceTimersByTimeAsync(10 * BANK_LINK_FRAME_LOAD_TIMEOUT_MS);
      expect(onEvent.mock.calls.map((c) => (c[0] as { code?: string }).code)).not.toContain("network");
      expect(card()).toBeNull();
      expect(document.querySelector("iframe")).not.toBeNull();
    }
  });

  it("a close before the timeout cancels it: only the exit is reported", async () => {
    const onEvent = jest.fn();
    const handle = await openLink({ token: TOKEN, onEvent });
    handle.close();
    await jest.advanceTimersByTimeAsync(10 * BANK_LINK_FRAME_LOAD_TIMEOUT_MS);
    expect(onEvent.mock.calls.map((c) => c[0])).toEqual([{ name: "exit", reason: "closed", step: null }]);
  });

  it("a close while the retry card shows ends the flow with exit closed and removes the card", async () => {
    const onEvent = jest.fn();
    const handle = await openLink({ token: TOKEN, onEvent, container: "#bank" });
    await jest.advanceTimersByTimeAsync(BANK_LINK_FRAME_LOAD_TIMEOUT_MS);
    expect(document.querySelector("#bank .didit-load-error")).not.toBeNull();
    handle.close();
    expect(onEvent.mock.calls.map((c) => c[0])).toEqual([
      { name: "error", code: "network" },
      { name: "exit", reason: "closed", step: null }
    ]);
    expect(document.querySelector("#bank")?.children.length).toBe(0);
    await jest.advanceTimersByTimeAsync(10 * BANK_LINK_FRAME_LOAD_TIMEOUT_MS);
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("retry asks again, loads a fresh frame at the new frame id, and a working frame then cancels the wait", async () => {
    const onEvent = jest.fn();
    await openLink({ token: TOKEN, onEvent });
    await jest.advanceTimersByTimeAsync(BANK_LINK_FRAME_LOAD_TIMEOUT_MS);
    policy().mockResolvedValue({ valid: true, frame_id: "frame_second_attempt", allowed_origins: [window.location.origin] });
    retryButton().click();
    await jest.advanceTimersByTimeAsync(0);
    expect(card()).toBeNull();
    expect(new URL(frame().src).pathname).toBe("/bank/frame/frame_second_attempt");
    expect(frame().style.display).toBe("");
    expect(policy()).toHaveBeenCalledTimes(2);
    send(msg("opened", { link_id: LINK, mode: "connect", access: "ongoing" }));
    await jest.advanceTimersByTimeAsync(10 * BANK_LINK_FRAME_LOAD_TIMEOUT_MS);
    expect(onEvent.mock.calls.map((c) => (c[0] as { name: string }).name)).toEqual(["error", "opened"]);
  });

  it("a retried frame that stays silent reports its own error once more, never twice for one attempt", async () => {
    const onEvent = jest.fn();
    await openLink({ token: TOKEN, onEvent });
    await jest.advanceTimersByTimeAsync(BANK_LINK_FRAME_LOAD_TIMEOUT_MS);
    retryButton().click();
    await jest.advanceTimersByTimeAsync(BANK_LINK_FRAME_LOAD_TIMEOUT_MS);
    expect(onEvent).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(10 * BANK_LINK_FRAME_LOAD_TIMEOUT_MS);
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("the browser's error event on the frame reports the same single error and does not double with the timer", async () => {
    const onEvent = jest.fn();
    await openLink({ token: TOKEN, onEvent });
    frame().dispatchEvent(new Event("error"));
    expect(onEvent.mock.calls.map((c) => c[0])).toEqual([{ name: "error", code: "network" }]);
    expect(card()).not.toBeNull();
    await jest.advanceTimersByTimeAsync(10 * BANK_LINK_FRAME_LOAD_TIMEOUT_MS);
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("a late message of the frame that was given up on is ignored", async () => {
    const onEvent = jest.fn();
    await openLink({ token: TOKEN, onEvent });
    await jest.advanceTimersByTimeAsync(BANK_LINK_FRAME_LOAD_TIMEOUT_MS);
    send(msg("opened", { link_id: LINK, mode: "connect", access: "ongoing" }));
    send(msg("error", { code: "network" }));
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("leaves no timer behind after the flow is disposed", async () => {
    const onEvent = jest.fn();
    await openLink({ token: TOKEN, onEvent });
    DiditSdk.reset();
    await jest.advanceTimersByTimeAsync(10 * BANK_LINK_FRAME_LOAD_TIMEOUT_MS);
    expect(onEvent).not.toHaveBeenCalled();
    expect(document.querySelector(".didit-load-error")).toBeNull();
  });
});

describe("a link the service refuses leaves a card with a Close control", () => {
  const policy = () => jest.spyOn(bankLinkRuntime, "fetchPolicy");
  const card = () => document.querySelector<HTMLElement>(".didit-load-error");
  const closeButton = () => card()?.querySelector("button") as HTMLButtonElement;
  const refusals: Array<[string, () => void, string]> = [
    ["origin not allowed", () => policy().mockResolvedValue({ valid: true, frame_id: FRAME_ID, allowed_origins: ["https://other.example"] }), "origin_not_allowed"],
    ["unknown link", () => policy().mockResolvedValue({ valid: false }), "invalid_token"]
  ];

  it.each(refusals)("%s: events as before, and the person sees a card they can close", async (_name, arrange, code) => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    arrange();
    const opener = document.body.appendChild(document.createElement("button"));
    opener.focus();
    const onEvent = jest.fn();
    const handle = await open({ token: TOKEN, onEvent });
    expect(onEvent.mock.calls.map((c) => c[0])).toEqual([
      { name: "error", code },
      { name: "exit", reason: "not_allowed", step: null }
    ]);
    expect(handle.state).toBe("closed");
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.querySelector(".didit-modal-overlay.active")).not.toBeNull();
    expect(card()?.textContent).toContain("can't be opened here");
    expect(card()?.textContent ?? "").not.toMatch(/origin|allowed|token|blt_|policy/i);
    expect(document.activeElement).toBe(closeButton());
    expect(document.documentElement.style.overflow).toBe("hidden");
    closeButton().click();
    expect(card()).toBeNull();
    expect(document.querySelector(".didit-modal-overlay")).toBeNull();
    expect(document.documentElement.style.overflow).toBe("");
    expect(onEvent).toHaveBeenCalledTimes(2); // Close reports nothing more: the flow already ended
    expect(document.activeElement).toBe(opener);
  });

  it("Escape and the host's own close also remove the card, with no second exit", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    policy().mockResolvedValue({ valid: false });
    const onExit = jest.fn();
    await open({ token: TOKEN, onExit });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(card()).toBeNull();
    const second = await open({ token: TOKEN, onExit });
    expect(card()).not.toBeNull();
    second.close();
    expect(card()).toBeNull();
    expect(onExit).toHaveBeenCalledTimes(2); // one per opened link, none from the closes
  });

  it("inline: the card stands in the container, in the person's language, and Close empties it", async () => {
    policy().mockResolvedValue({ valid: false });
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    await open({ token: TOKEN, container: "#bank", locale: "es" });
    const inline = document.querySelector("#bank .didit-load-error") as HTMLElement;
    expect(inline.textContent).toContain("Esta conexión bancaria no se puede abrir aquí");
    expect(document.querySelector(".didit-modal-overlay")).toBeNull();
    (inline.querySelector("button") as HTMLButtonElement).click();
    expect(document.querySelector("#bank")?.children.length).toBe(0);
  });

  it("a regional locale falls back to the language's text", () => {
    expect(getBankLinkModalTranslations("es-MX").refusalMessage).toBe(getBankLinkModalTranslations("es").refusalMessage);
  });
});

describe("the timeout card has a Close control", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("Close fires exit closed once, like a close anywhere else, and removes the card", async () => {
    const onEvent = jest.fn();
    const onExit = jest.fn();
    DiditSdk.shared.openBankLink({ token: TOKEN, onEvent, onExit });
    await jest.advanceTimersByTimeAsync(BANK_LINK_FRAME_LOAD_TIMEOUT_MS);
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".didit-load-error button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["Try again", "Close"]);
    buttons[1].click();
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith({ reason: "closed", step: null });
    expect(onEvent.mock.calls.map((c) => c[0])).toEqual([
      { name: "error", code: "network" },
      { name: "exit", reason: "closed", step: null }
    ]);
    expect(document.querySelector(".didit-load-error")).toBeNull();
    expect(document.querySelector(".didit-modal-overlay")).toBeNull();
    await jest.advanceTimersByTimeAsync(10 * BANK_LINK_FRAME_LOAD_TIMEOUT_MS);
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("Tab stays between the card's two buttons", async () => {
    DiditSdk.shared.openBankLink({ token: TOKEN });
    await jest.advanceTimersByTimeAsync(BANK_LINK_FRAME_LOAD_TIMEOUT_MS);
    const [retry, close] = Array.from(document.querySelectorAll<HTMLButtonElement>(".didit-load-error button"));
    expect(document.activeElement).toBe(retry);
    const sentinel = document.querySelector<HTMLElement>(".didit-focus-sentinel") as HTMLElement;
    sentinel.focus();
    expect(document.activeElement).toBe(retry);
    retry.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(close);
  });
});

describe("an invalid option is loud", () => {
  it("a plain http baseUrl throws, warns, and reports error invalid_options through onEvent, synchronously", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const onEvent = jest.fn();
    let thrown: unknown;
    try {
      DiditSdk.shared.openBankLink({ token: TOKEN, baseUrl: "http://verify.example.com", onEvent });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DiditBankLinkError);
    expect((thrown as DiditBankLinkError).code).toBe("invalid_options");
    expect(onEvent.mock.calls.map((c) => c[0])).toEqual([{ name: "error", code: "invalid_options" }]);
    expect(String(warn.mock.calls[0][0])).toContain("baseUrl must be an https URL");
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("http stays allowed for localhost and 127.0.0.1 only", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const ok of ["http://localhost:4173", "http://127.0.0.1:4173"]) {
      DiditSdk.reset();
      await open({ token: TOKEN, baseUrl: ok });
      expect(document.querySelector("iframe")).not.toBeNull();
    }
    for (const bad of ["http://localhost.evil.example", "http://192.168.1.10", "ftp://verify.example.com"]) {
      expect(() => DiditSdk.shared.openBankLink({ token: TOKEN, baseUrl: bad })).toThrow(DiditBankLinkError);
    }
  });

  it("the same for apiBaseUrl, and for resumeBankLink (its promise rejects after the event)", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const onEvent = jest.fn();
    expect(() => DiditSdk.shared.openBankLink({ token: TOKEN, apiBaseUrl: "http://api.example.com", onEvent })).toThrow(DiditBankLinkError);
    await expect(DiditSdk.shared.resumeBankLink({ baseUrl: "http://verify.example.com", onEvent })).rejects.toMatchObject({ code: "invalid_options" });
    expect(onEvent.mock.calls.map((c) => c[0])).toEqual([
      { name: "error", code: "invalid_options" },
      { name: "error", code: "invalid_options" }
    ]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("an invalid token is not an invalid option: it still only throws", () => {
    const onEvent = jest.fn();
    expect(() => DiditSdk.shared.openBankLink({ token: "nope", onEvent })).toThrow(DiditBankLinkError);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("a callback that throws on the event does not hide the original error", () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const onEvent = jest.fn(() => {
      throw new Error("host bug");
    });
    expect(() => DiditSdk.shared.openBankLink({ token: TOKEN, baseUrl: "http://x.example.com", onEvent })).toThrow(DiditBankLinkError);
  });
});
