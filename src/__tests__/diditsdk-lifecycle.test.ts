import { jest, describe, it, expect, afterEach } from "@jest/globals";
import { DiditSdk } from "../DiditSdk";
import type { VerificationEvent } from "../types";
import type { VerificationModal } from "../modal";
import { CSS_CLASSES } from "../constants";

interface DiditSdkInternals {
  _modal: VerificationModal | null;
}

interface ModalInternals {
  iframe: HTMLIFrameElement | null;
  container: HTMLDivElement | null;
}

function verificationIframe(): HTMLIFrameElement {
  const modal = (DiditSdk.shared as unknown as DiditSdkInternals)._modal;
  const iframe = modal ? (modal as unknown as ModalInternals).iframe : null;
  if (!iframe) throw new Error("No verification iframe is presented");
  return iframe;
}

function dispatchMessage(data: VerificationEvent): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      origin: "https://verify.didit.me",
      source: verificationIframe().contentWindow as WindowProxy | null
    })
  );
}

function confirmExit(): void {
  const container = (DiditSdk.shared as unknown as DiditSdkInternals)._modal as unknown as ModalInternals;
  container.container?.querySelector<HTMLButtonElement>(`.${CSS_CLASSES.closeButton}`)?.click();
  container.container?.querySelector<HTMLButtonElement>('[data-action="exit"]')?.click();
}

function start(url = "https://verify.didit.me/session/token"): Promise<void> {
  return DiditSdk.shared.startVerification({ url });
}

describe("DiditSdk verification lifecycle", () => {
  afterEach(() => {
    DiditSdk.reset();
    document.getElementById("didit-sdk-styles")?.remove();
    document.getElementById("embedded-host")?.remove();
    document.body.style.overflow = "";
  });

  it("reports completed to the integrator and keeps the modal open", async () => {
    const states: Array<{ state: string; error?: string }> = [];
    const onComplete = jest.fn();
    DiditSdk.shared.onStateChange = (state, error) => states.push({ state, error });
    DiditSdk.shared.onComplete = onComplete;
    await start();

    dispatchMessage({ type: "didit:completed", data: { sessionId: "ses_1", status: "Approved" }, timestamp: 1 });

    expect(onComplete).toHaveBeenCalledWith({
      type: "completed",
      session: { sessionId: "ses_1", status: "Approved" }
    });
    expect(states.map((entry) => entry.state)).toEqual(["loading"]);
    expect(DiditSdk.shared.isPresented).toBe(true);
  });

  it("closes the modal on completion only when configured, still reporting idle", async () => {
    const states: string[] = [];
    DiditSdk.shared.onStateChange = (state) => states.push(state);
    await DiditSdk.shared.startVerification({
      url: "https://verify.didit.me/session/token",
      configuration: { closeModalOnComplete: true }
    });

    dispatchMessage({ type: "didit:completed", data: { sessionId: "ses_1", status: "Approved" }, timestamp: 1 });

    expect(DiditSdk.shared.isPresented).toBe(false);
    expect(states).toEqual(["loading", "idle"]);
  });

  it("keeps the modal open after completion by default", async () => {
    await start();

    dispatchMessage({ type: "didit:completed", data: { sessionId: "ses_1", status: "Approved" }, timestamp: 1 });

    expect(DiditSdk.shared.isPresented).toBe(true);
  });

  it("reports cancelled with the session the flow already announced when the user closes the modal", async () => {
    const onComplete = jest.fn();
    DiditSdk.shared.onComplete = onComplete;
    await start();

    dispatchMessage({ type: "didit:ready", data: { sessionId: "ses_1" }, timestamp: 1 });
    confirmExit();

    expect(onComplete).toHaveBeenCalledWith({
      type: "cancelled",
      session: { sessionId: "ses_1", status: "Pending" }
    });
    expect(DiditSdk.shared.isPresented).toBe(false);
    expect(DiditSdk.shared.state).toBe("idle");
  });

  it("reports cancelled from the flow's own cancelled event and closes the modal", async () => {
    const onComplete = jest.fn();
    DiditSdk.shared.onComplete = onComplete;
    await start();

    dispatchMessage({ type: "didit:cancelled", data: { sessionId: "ses_2" }, timestamp: 1 });

    expect(onComplete).toHaveBeenCalledWith({
      type: "cancelled",
      session: { sessionId: "ses_2", status: "Pending" }
    });
    expect(DiditSdk.shared.isPresented).toBe(false);
  });

  it("delivers an error from the flow to onEvent without completing the session", async () => {
    const onComplete = jest.fn();
    const onEvent = jest.fn();
    DiditSdk.shared.onComplete = onComplete;
    DiditSdk.shared.onEvent = onEvent;
    await start();

    dispatchMessage({ type: "didit:error", data: { error: "network_error", step: "document" }, timestamp: 1 });

    expect(onEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "didit:error", data: expect.objectContaining({ error: "network_error" }) })
    );
    expect(onComplete).not.toHaveBeenCalled();
    expect(DiditSdk.shared.isPresented).toBe(true);
  });

  it("stays in the error state with its message after a failed launch, and clears it on the next launch", async () => {
    const states: Array<{ state: string; error?: string }> = [];
    const onComplete = jest.fn();
    DiditSdk.shared.onStateChange = (state, error) => states.push({ state, error });
    DiditSdk.shared.onComplete = onComplete;

    await DiditSdk.shared.startVerification({ url: "" });

    expect(onComplete).toHaveBeenCalledWith({
      type: "failed",
      error: { type: "unknown", message: "Invalid options: url is required" }
    });
    expect(DiditSdk.shared.state).toBe("error");
    expect(DiditSdk.shared.errorMessage).toBe("Invalid options: url is required");
    expect(states).toEqual([{ state: "error", error: "Invalid options: url is required" }]);

    await start();
    expect(DiditSdk.shared.state).toBe("loading");
    expect(DiditSdk.shared.errorMessage).toBeUndefined();
  });

  it("fails a launch in embedded mode when the host element is missing instead of presenting nothing", async () => {
    const onComplete = jest.fn();
    DiditSdk.shared.onComplete = onComplete;

    await DiditSdk.shared.startVerification({
      url: "https://verify.didit.me/session/token",
      configuration: { embedded: true, embeddedContainerId: "missing-host" }
    });

    expect(onComplete).toHaveBeenCalledWith({
      type: "failed",
      error: { type: "unknown", message: 'Embedded container "#missing-host" was not found in the page.' }
    });
    expect(document.querySelector(`.${CSS_CLASSES.overlay}`)).toBeNull();
    expect(DiditSdk.shared.state).toBe("error");
  });

  it("fails a launch in embedded mode without an element id", async () => {
    const onComplete = jest.fn();
    DiditSdk.shared.onComplete = onComplete;

    await DiditSdk.shared.startVerification({
      url: "https://verify.didit.me/session/token",
      configuration: { embedded: true }
    });

    expect(onComplete).toHaveBeenCalledWith({
      type: "failed",
      error: {
        type: "unknown",
        message: "Embedded mode requires embeddedContainerId: the id of the element that hosts the verification."
      }
    });
  });

  it("starts embedded mode inside the host element it was given", async () => {
    const host = document.createElement("div");
    host.id = "embedded-host";
    document.body.appendChild(host);

    await DiditSdk.shared.startVerification({
      url: "https://verify.didit.me/session/token",
      configuration: { embedded: true, embeddedContainerId: "embedded-host" }
    });

    expect(host.querySelector(`.${CSS_CLASSES.embedded}`)).not.toBeNull();
    expect(host.querySelector(`.${CSS_CLASSES.iframe}`)).not.toBeNull();
    expect(document.querySelector(`.${CSS_CLASSES.overlay}`)).toBeNull();
    expect(DiditSdk.shared.isPresented).toBe(true);
  });

  it("reports cancelled with the announced session in embedded mode when the programmatic close runs", async () => {
    const host = document.createElement("div");
    host.id = "embedded-host";
    document.body.appendChild(host);
    const onComplete = jest.fn();
    DiditSdk.shared.onComplete = onComplete;
    await DiditSdk.shared.startVerification({
      url: "https://verify.didit.me/session/token",
      configuration: { embedded: true, embeddedContainerId: "embedded-host" }
    });

    dispatchMessage({ type: "didit:ready", data: { sessionId: "ses_3" }, timestamp: 1 });
    DiditSdk.shared.close();

    expect(onComplete).toHaveBeenCalledWith({
      type: "cancelled",
      session: { sessionId: "ses_3", status: "Pending" }
    });
  });
});
