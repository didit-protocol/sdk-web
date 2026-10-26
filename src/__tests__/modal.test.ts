import { jest, describe, it, expect, afterEach } from "@jest/globals";
import { VerificationModal } from "../modal";
import type { DiditSdkConfiguration, VerificationEvent } from "../types";
import { CSS_CLASSES } from "../constants";

interface ModalInternals {
  iframe: HTMLIFrameElement | null;
  container: HTMLDivElement | null;
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

function getContainer(modal: VerificationModal): HTMLDivElement {
  const container = (modal as unknown as ModalInternals).container;
  if (!container) throw new Error("Modal has no container");
  return container;
}

function createModal(configuration: DiditSdkConfiguration = noConfirmConfig): {
  modal: VerificationModal;
  onMessage: jest.Mock<(event: VerificationEvent) => void>;
  onCloseConfirmed: jest.Mock<() => void>;
} {
  const onMessage = jest.fn();
  const onCloseConfirmed = jest.fn();
  const modal = new VerificationModal(configuration, {
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

describe("VerificationModal confirmation focus", () => {
  const openModals: VerificationModal[] = [];

  afterEach(() => {
    openModals.forEach((modal) => modal.destroy());
    openModals.length = 0;
    document.getElementById("didit-sdk-styles")?.remove();
    document.body.style.overflow = "";
  });

  function openModal(configuration: DiditSdkConfiguration = {}) {
    const created = createModal({ showExitConfirmation: true, ...configuration });
    openModals.push(created.modal);
    created.modal.open("https://verify.didit.me/session");
    const container = getContainer(created.modal);
    const close = container.querySelector<HTMLButtonElement>(`.${CSS_CLASSES.closeButton}`)!;
    const dialog = container.querySelector<HTMLDivElement>(`.${CSS_CLASSES.confirmBox}`)!;
    const continueButton = dialog.querySelector<HTMLButtonElement>('[data-action="continue"]')!;
    const exitButton = dialog.querySelector<HTMLButtonElement>('[data-action="exit"]')!;
    return { ...created, close, dialog, continueButton, exitButton, iframe: getIframe(created.modal) };
  }

  it("focuses a labelled confirmation and makes Exit a button while the flow is inert", () => {
    const { close, dialog, exitButton, iframe } = openModal();
    // Pointer clicks do not focus buttons in every browser.
    close.click();

    expect(document.activeElement).toBe(dialog);
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("Exit verification?");
    expect(exitButton.tagName).toBe("BUTTON");
    expect(exitButton.type).toBe("button");
    expect(iframe.inert).toBe(true);
    expect(close.inert).toBe(true);
  });

  it.each(["Continue", "Escape"])("restores focus to the trigger after %s", (action) => {
    const { close, dialog, continueButton, iframe, onCloseConfirmed } = openModal();
    close.click();
    if (action === "Continue") continueButton.click();
    else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(document.activeElement).toBe(close);
    expect(dialog.parentElement?.classList.contains("active")).toBe(false);
    expect(iframe.inert).toBe(false);
    expect(close.inert).toBe(false);
    expect(onCloseConfirmed).not.toHaveBeenCalled();
  });

  it("keeps the original trigger when the flow repeats its close request", () => {
    const { close, iframe, continueButton } = openModal();
    close.click();
    continueButton.focus();
    dispatchMessage(iframe.contentWindow, { type: "didit:close_request", timestamp: 1 });
    continueButton.click();

    expect(document.activeElement).toBe(close);
  });

  it("restores iframe focus after a flow close request with no SDK close button", () => {
    const { iframe, dialog, continueButton } = openModal({ showCloseButton: false });
    iframe.focus();
    dispatchMessage(iframe.contentWindow, { type: "didit:close_request", timestamp: 1 });
    expect(document.activeElement).toBe(dialog);
    continueButton.click();

    expect(document.activeElement).toBe(iframe);
    expect(iframe.inert).toBe(false);
  });

  it("clears containment on reopen, close and destroy", () => {
    const { modal, close, iframe, dialog } = openModal();
    close.click();
    modal.open("https://verify.didit.me/session");
    expect(iframe.inert).toBe(false);
    expect(close.inert).toBe(false);
    iframe.focus();
    expect(document.activeElement).toBe(iframe);

    close.click();
    expect(document.activeElement).toBe(dialog);
    modal.close();
    expect(iframe.inert).toBe(false);
    modal.open("https://verify.didit.me/session");
    close.click();
    modal.destroy();
    expect(dialog.isConnected).toBe(false);
    const next = openModal();
    next.close.focus();
    expect(document.activeElement).toBe(next.close);
  });

  it("only contains focus and handles keys in the topmost confirmation", () => {
    const first = openModal();
    first.close.click();
    const second = openModal();
    second.close.focus();
    expect(document.activeElement).toBe(second.close);
    second.close.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", cancelable: true }));
    expect(document.activeElement).toBe(second.continueButton);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.activeElement).toBe(second.close);
    expect(first.dialog.parentElement?.classList.contains("active")).toBe(true);

    second.modal.close();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", cancelable: true }));
    expect(document.activeElement).toBe(first.continueButton);
    first.exitButton.click();
    expect(first.onCloseConfirmed).toHaveBeenCalledTimes(1);
    expect(second.onCloseConfirmed).not.toHaveBeenCalled();
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

describe("VerificationModal flow layout", () => {
  const openModals: VerificationModal[] = [];

  afterEach(() => {
    openModals.forEach((modal) => modal.destroy());
    openModals.length = 0;
    document.getElementById("didit-sdk-styles")?.remove();
    document.getElementById("host")?.remove();
    document.body.style.overflow = "";
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  function openModal(url = "https://verify.didit.me/session/a", configuration?: DiditSdkConfiguration) {
    const created = createModal(configuration);
    openModals.push(created.modal);
    created.modal.open(url);
    return created;
  }

  function postLayout(modal: VerificationModal, data: unknown, origin?: string): void {
    dispatchMessage(getIframe(modal).contentWindow, { type: "didit:layout", data, timestamp: 1 }, origin);
  }

  function isFlowSized(modal: VerificationModal): boolean {
    return getContainer(modal).classList.contains(CSS_CLASSES.flowSized);
  }

  it("keeps the fixed modal until the flow reports its layout", () => {
    const { modal } = openModal();

    expect(isFlowSized(modal)).toBe(false);
    expect(getContainer(modal).style.getPropertyValue("--didit-flow-height")).toBe("");
  });

  it("sizes the modal from the reported layout and keeps the message from onMessage", () => {
    const { modal, onMessage } = openModal();

    postLayout(modal, { contentHeight: 612.4, colorScheme: "dark", dir: "rtl" });

    const container = getContainer(modal);
    expect(isFlowSized(modal)).toBe(true);
    expect(container.style.getPropertyValue("--didit-flow-height")).toBe("613px");
    expect(container.dataset.diditTheme).toBe("dark");
    expect(container.dataset.diditDir).toBe("rtl");
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("follows the content height each time the flow reports it, including as a JSON string", () => {
    const { modal } = openModal();

    postLayout(modal, { contentHeight: 600 });
    dispatchMessage(
      getIframe(modal).contentWindow,
      JSON.stringify({ type: "didit:layout", data: { contentHeight: 560 }, timestamp: 2 })
    );

    expect(getContainer(modal).style.getPropertyValue("--didit-flow-height")).toBe("560px");
  });

  it.each([
    ["no data", undefined],
    ["no content height", { colorScheme: "dark" }],
    ["a content height as text", { contentHeight: "600" }],
    ["a zero content height", { contentHeight: 0 }],
    ["a negative content height", { contentHeight: -10 }],
    ["a content height that is not a number", { contentHeight: Number.NaN }],
    ["an infinite content height", { contentHeight: Number.POSITIVE_INFINITY }]
  ])("ignores a layout message with %s", (_, data) => {
    const { modal, onMessage } = openModal();

    postLayout(modal, data);

    expect(isFlowSized(modal)).toBe(false);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("ignores a layout message from another window or a disallowed origin", () => {
    const { modal } = openModal();

    dispatchMessage(window, { type: "didit:layout", data: { contentHeight: 600 }, timestamp: 1 });
    postLayout(modal, { contentHeight: 600 }, "https://attacker.example");

    expect(isFlowSized(modal)).toBe(false);
  });

  it("follows the verification URL's language and the device colour scheme when the flow does not say", () => {
    const { modal } = openModal("https://verify.didit.me/ar/session/a");

    postLayout(modal, { contentHeight: 600, colorScheme: "sepia", dir: "up" });

    expect(getContainer(modal).dataset.diditDir).toBe("rtl");
    expect(getContainer(modal).dataset.diditTheme).toBe("light");

    (window as { matchMedia?: unknown }).matchMedia = (query: string) => ({
      matches: query === "(prefers-color-scheme: dark)"
    });
    postLayout(modal, { contentHeight: 600 });

    expect(getContainer(modal).dataset.diditTheme).toBe("dark");
  });

  it("lays a left-to-right language out left to right", () => {
    const { modal } = openModal("https://verify.didit.me/en/session/a");

    postLayout(modal, { contentHeight: 600 });

    expect(getContainer(modal).dataset.diditDir).toBe("ltr");
  });

  it("goes back to the fixed modal when it is re-opened or closed", () => {
    const { modal } = openModal();

    postLayout(modal, { contentHeight: 600, colorScheme: "dark", dir: "rtl" });
    modal.open("https://verify.didit.me/session/b");

    const container = getContainer(modal);
    expect(isFlowSized(modal)).toBe(false);
    expect(container.style.getPropertyValue("--didit-flow-height")).toBe("");
    expect(container.dataset.diditTheme).toBeUndefined();
    expect(container.dataset.diditDir).toBeUndefined();

    postLayout(modal, { contentHeight: 600 });
    expect(isFlowSized(modal)).toBe(true);
    modal.close();
    expect(isFlowSized(modal)).toBe(false);
  });

  it("leaves embedded mode to the host element", () => {
    const host = document.createElement("div");
    host.id = "host";
    document.body.appendChild(host);
    const { modal, onMessage } = openModal("https://verify.didit.me/session/a", {
      embedded: true,
      embeddedContainerId: "host"
    });

    postLayout(modal, { contentHeight: 600 });

    expect(isFlowSized(modal)).toBe(false);
    expect(getContainer(modal).style.getPropertyValue("--didit-flow-height")).toBe("");
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("grows to the handoff card on a computer, follows the content in a narrow window and fills a phone", () => {
    openModal();
    const styles = document.getElementById("didit-sdk-styles")?.textContent ?? "";
    const wide = /@media \(min-width: 1024px\) \{([\s\S]*?)\n      \}/.exec(styles)?.[1] ?? "";
    const flowIframe = new RegExp(`\\.${CSS_CLASSES.flowSized} \\.${CSS_CLASSES.iframe} \\{([^}]*)\\}`).exec(styles)?.[1];

    expect(wide).toMatch(/width: 90vw;\s+max-width: 960px/);
    expect(wide).toContain("height: 660px");
    expect(flowIframe).toMatch(/height: var\(--didit-flow-height\);\s+max-height: 90vh;\s+max-height: 90dvh/);
    expect(styles).toMatch(
      new RegExp(`@media \\(max-width: 540px\\) \\{\\s+\\.${CSS_CLASSES.container}\\.${CSS_CLASSES.flowSized} \\{[^}]*max-width: 100%`)
    );
  });

  it("draws the design system close icon only once the flow reports its layout", () => {
    openModal("https://verify.didit.me/session/a", { showExitConfirmation: false });
    const button = document.querySelector(`.${CSS_CLASSES.closeButton}`);

    expect(button?.querySelector(`.${CSS_CLASSES.closeIconLegacy}`)).not.toBeNull();
    expect(button?.querySelector(`.${CSS_CLASSES.closeIcon}`)).not.toBeNull();
    const styles = document.getElementById("didit-sdk-styles")?.textContent ?? "";
    expect(styles).toMatch(new RegExp(`\\.${CSS_CLASSES.closeIcon} \\{\\s+display: none;`));
  });

  it("opens the exit confirmation at its top after it was scrolled and dismissed", () => {
    openModal("https://verify.didit.me/session/a", { showExitConfirmation: true });
    const close = document.querySelector<HTMLButtonElement>(`.${CSS_CLASSES.closeButton}`);
    const overlay = document.querySelector<HTMLDivElement>(`.${CSS_CLASSES.confirmOverlay}`);
    if (!close || !overlay) throw new Error("Modal has no exit confirmation");

    close.click();
    overlay.scrollTop = 240;
    overlay.querySelector<HTMLButtonElement>('[data-action="continue"]')?.click();
    expect(overlay.classList.contains("active")).toBe(false);

    close.click();
    expect(overlay.classList.contains("active")).toBe(true);
    expect(overlay.scrollTop).toBe(0);
  });
});
