import { jest, describe, it, expect, afterEach } from "@jest/globals";
import { VerificationModal } from "../modal";
import type { DiditSdkConfiguration, VerificationEvent } from "../types";
import { CSS_CLASSES } from "../constants";

interface ModalInternals {
  iframe: HTMLIFrameElement | null;
}

function getIframe(modal: VerificationModal): HTMLIFrameElement {
  const iframe = (modal as unknown as ModalInternals).iframe;
  if (!iframe) throw new Error("Modal has no iframe");
  return iframe;
}

function dispatchMessage(source: Window | null, data: unknown, origin = "https://verify.didit.me"): void {
  window.dispatchEvent(new MessageEvent("message", { data, origin, source: source as WindowProxy | null }));
}

// showExitConfirmation disabled so Escape drives onCloseConfirmed directly,
// without an intermediate confirmation dialog, keeping these tests focused.
const noConfirmConfig: DiditSdkConfiguration = { showExitConfirmation: false };

function createModal(): {
  modal: VerificationModal;
  onMessage: jest.Mock<(event: VerificationEvent) => void>;
  onCloseConfirmed: jest.Mock<() => void>;
} {
  const onMessage = jest.fn();
  const onCloseConfirmed = jest.fn();
  const modal = new VerificationModal(noConfirmConfig, {
    onClose: () => {},
    onCloseConfirmed,
    onMessage,
    onIframeLoad: () => {}
  });
  return { modal, onMessage, onCloseConfirmed };
}

describe("VerificationModal cross-modal isolation", () => {
  const openModals: VerificationModal[] = [];

  afterEach(() => {
    openModals.forEach((modal) => modal.destroy());
    openModals.length = 0;
    document.body.style.overflow = "";
  });

  it("only delivers a postMessage to the modal whose iframe is the event source", () => {
    const a = createModal();
    const b = createModal();
    openModals.push(a.modal, b.modal);
    a.modal.open("https://verify.didit.me/session/a");
    b.modal.open("https://verify.didit.me/session/b");

    dispatchMessage(getIframe(a.modal).contentWindow, { type: "didit:completed", timestamp: 1 });

    expect(a.onMessage).toHaveBeenCalledTimes(1);
    expect(b.onMessage).not.toHaveBeenCalled();
  });

  it("ignores a message whose source does not match this modal's iframe", () => {
    const a = createModal();
    openModals.push(a.modal);
    a.modal.open("https://verify.didit.me/session/a");

    // Source is the top window itself, not the modal's iframe.
    dispatchMessage(window, { type: "didit:completed", timestamp: 1 });

    expect(a.onMessage).not.toHaveBeenCalled();
  });

  it("stops delivering messages after close(), and resumes once re-opened", () => {
    const a = createModal();
    openModals.push(a.modal);
    a.modal.open("https://verify.didit.me/session/a");
    const firstIframeWindow = getIframe(a.modal).contentWindow;

    a.modal.close();
    dispatchMessage(firstIframeWindow, { type: "didit:completed", timestamp: 1 });
    expect(a.onMessage).not.toHaveBeenCalled();

    a.modal.open("https://verify.didit.me/session/a-2");
    dispatchMessage(getIframe(a.modal).contentWindow, { type: "didit:completed", timestamp: 2 });
    expect(a.onMessage).toHaveBeenCalledTimes(1);
  });

  it("only the topmost open modal reacts to Escape", () => {
    const a = createModal();
    const b = createModal();
    openModals.push(a.modal, b.modal);
    a.modal.open("https://verify.didit.me/session/a");
    b.modal.open("https://verify.didit.me/session/b");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(b.onCloseConfirmed).toHaveBeenCalledTimes(1);
    expect(a.onCloseConfirmed).not.toHaveBeenCalled();
  });

  it("restores the body overflow value observed at open() instead of unconditionally clearing it", () => {
    document.body.style.overflow = "";
    const a = createModal();
    const b = createModal();
    openModals.push(a.modal, b.modal);

    a.modal.open("https://verify.didit.me/session/a");
    expect(document.body.style.overflow).toBe("hidden");

    b.modal.open("https://verify.didit.me/session/b");
    expect(document.body.style.overflow).toBe("hidden");

    // Closing the later-opened modal must not clobber the scroll lock "a" still owns.
    b.modal.close();
    expect(document.body.style.overflow).toBe("hidden");

    a.modal.close();
    expect(document.body.style.overflow).toBe("");
  });

  it("restores the pre-lock body overflow after re-opening an already-open modal", () => {
    document.body.style.overflow = "scroll";
    const a = createModal();
    openModals.push(a.modal);

    a.modal.open("https://verify.didit.me/session/a");
    expect(document.body.style.overflow).toBe("hidden");

    // Re-open the same instance while it is still open (supported: open()
    // dedupes itself in the stack). This must not overwrite the saved pre-lock
    // overflow with the lock this modal already applied.
    a.modal.open("https://verify.didit.me/session/a-2");
    expect(document.body.style.overflow).toBe("hidden");

    a.modal.close();
    expect(document.body.style.overflow).toBe("scroll");
  });

  it("falls back to Escape acting on the remaining modal once the topmost one closes", () => {
    const a = createModal();
    const b = createModal();
    openModals.push(a.modal, b.modal);
    a.modal.open("https://verify.didit.me/session/a");
    b.modal.open("https://verify.didit.me/session/b");

    b.modal.close();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(a.onCloseConfirmed).toHaveBeenCalledTimes(1);
  });
});

describe("VerificationModal iframe sizing", () => {
  const openModals: VerificationModal[] = [];

  afterEach(() => {
    openModals.forEach((modal) => modal.destroy());
    openModals.length = 0;
    document.getElementById("didit-sdk-styles")?.remove();
    document.body.style.overflow = "";
  });

  function injectedStyles(): string {
    const { modal } = createModal();
    openModals.push(modal);
    modal.open("https://verify.didit.me/session");
    const el = document.getElementById("didit-sdk-styles");
    if (!el) throw new Error("Stylesheet was not injected");
    return el.textContent ?? "";
  }

  // First matching rule body for a selector: the base rule, before any
  // media-query or descendant override later in the sheet.
  function baseRuleBody(styles: string, className: string): string {
    const match = new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`).exec(styles);
    if (!match) throw new Error(`No rule found for .${className}`);
    return match[1];
  }

  function descendantRuleBody(styles: string, ancestor: string, className: string): string {
    const match = new RegExp(`\\.${ancestor}\\s+\\.${className}\\s*\\{([^}]*)\\}`).exec(styles);
    if (!match) throw new Error(`No rule found for .${ancestor} .${className}`);
    return match[1];
  }

  it("bounds the base iframe height by the container's viewport cap, so a short viewport cannot clip the flow", () => {
    const styles = injectedStyles();
    const container = baseRuleBody(styles, CSS_CLASSES.container);
    const iframe = baseRuleBody(styles, CSS_CLASSES.iframe);

    expect(container).toMatch(/max-height: 90vh;\s+max-height: 90dvh/);
    expect(container).toContain("max-height: 90dvh");
    expect(container).toContain("overflow: hidden");
    expect(iframe).toMatch(/height: 90vh;\s+height: 90dvh;\s+max-height: 700px/);
  });

  it("clears the modal height cap in embedded mode, so a tall host is not truncated", () => {
    const styles = injectedStyles();
    const embeddedIframe = descendantRuleBody(styles, CSS_CLASSES.embedded, CSS_CLASSES.iframe);

    expect(embeddedIframe).toContain("height: 100%");
    expect(embeddedIframe).toContain("max-height: none");
  });
});
