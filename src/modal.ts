import type { DiditSdkConfiguration, VerificationEvent } from "./types";
import { DEFAULT_CONFIG, CSS_CLASSES, LAYOUT_MESSAGE_TYPE } from "./constants";
import { SDKLogger, generateModalId, isAllowedOrigin, detectLanguageFromUrl, isRtlLanguage } from "./utils";
import { getTranslations } from "./translations";

export interface ModalState {
  isOpen: boolean;
  isLoading: boolean;
  showConfirmation: boolean;
}

export interface ModalCallbacks {
  onClose: () => void;
  onCloseConfirmed: () => void;
  onMessage: (event: VerificationEvent) => void;
  onIframeLoad: () => void;
}

/** The layout the hosted flow reports in a didit:layout message. */
export interface FlowLayout {
  /** Height of the flow's content in CSS pixels, its top bar included. */
  contentHeight: number;
  colorScheme: "light" | "dark";
  dir: "ltr" | "rtl";
}

export class VerificationModal {
  /**
   * Every currently-open modal, oldest first. Used so a single Escape
   * keypress (or other document-level shortcut) only acts on the topmost
   * modal when multiple VerificationModal instances are open at once (e.g.
   * a transaction action modal stacked over the verification modal).
   */
  private static openModals: VerificationModal[] = [];

  private modalId: string;
  private config: Required<Pick<DiditSdkConfiguration, "zIndex" | "showCloseButton" | "showExitConfirmation">>;
  private callbacks: ModalCallbacks;
  private state: ModalState = {
    isOpen: false,
    isLoading: true,
    showConfirmation: false
  };

  private overlay: HTMLDivElement | null = null;
  private container: HTMLDivElement | null = null;
  private iframe: HTMLIFrameElement | null = null;
  private loadingEl: HTMLDivElement | null = null;
  private confirmOverlay: HTMLDivElement | null = null;
  private confirmationTrigger: HTMLElement | null = null;
  private containerElement: HTMLElement;

  private boundHandleMessage: ((event: MessageEvent) => void) | null = null;
  private boundHandleKeydown: ((event: KeyboardEvent) => void) | null = null;
  private boundHandleFocusin: (() => void) | null = null;

  private embedded: boolean = false;
  private embeddedContainer: HTMLElement | null = null;
  private language: string = "en";

  /** body.style.overflow value observed right before this modal locked scroll, restored on close(). */
  private previousBodyOverflow: string | null = null;

  constructor(configuration: DiditSdkConfiguration | undefined, callbacks: ModalCallbacks) {
    this.modalId = generateModalId();
    this.config = {
      zIndex: configuration?.zIndex ?? DEFAULT_CONFIG.zIndex,
      showCloseButton: configuration?.showCloseButton ?? DEFAULT_CONFIG.showCloseButton,
      showExitConfirmation: configuration?.showExitConfirmation ?? DEFAULT_CONFIG.showExitConfirmation
    };
    this.callbacks = callbacks;
    this.containerElement = configuration?.containerElement ?? document.body;
    this.embedded = configuration?.embedded ?? false;
    if (this.embedded && configuration?.embeddedContainerId) {
      this.embeddedContainer = document.getElementById(configuration.embeddedContainerId);
    }
  }

  private injectStyles(): void {
    const styleId = "didit-sdk-styles";
    if (document.getElementById(styleId)) {
      return;
    }

    const styles = document.createElement("style");
    styles.id = styleId;
    styles.textContent = `
      .${CSS_CLASSES.overlay} {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        z-index: ${this.config.zIndex};
        justify-content: center;
        align-items: center;
        padding: 1rem;
        opacity: 0;
        transition: opacity 0.2s ease-out;
      }

      .${CSS_CLASSES.overlay}.active {
        display: flex;
        opacity: 1;
      }

      .${CSS_CLASSES.container} {
        position: relative;
        width: 100%;
        max-width: 500px;
        max-height: 90vh;
        max-height: 90dvh;
        border-radius: 16px;
        overflow: hidden;
        background: transparent;
      }

      .${CSS_CLASSES.overlay}.active .${CSS_CLASSES.container} {
        transform: scale(1);
      }

      .${CSS_CLASSES.iframe} {
        width: 100%;
        height: 90vh;
        height: 90dvh;
        max-height: 700px;
        border: none;
        display: block;
      }

      .${CSS_CLASSES.closeButton} {
        position: absolute;
        top: 4px;
        right: 4px;
        width: 24px;
        height: 24px;
        background: transparent;
        border: none;
        cursor: pointer;
        padding: 0;
        z-index: 10;
        outline: none;
      }

      .${CSS_CLASSES.closeButton}:hover,
      .${CSS_CLASSES.closeButton}:focus {
        background: transparent;
        opacity: 0.5;
      }

      .${CSS_CLASSES.closeButton} svg {
        stroke: #666;
        stroke-width: 2;
        stroke-linecap: round;
      }

      .${CSS_CLASSES.loading} {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #fafafa;
        z-index: 5;
      }

      .${CSS_CLASSES.loading}.hidden {
        display: none;
      }

      .${CSS_CLASSES.loading} svg {
        width: 4rem;
        height: 4rem;
        animation: didit-spin 1s linear infinite;
      }

      .${CSS_CLASSES.loading} circle {
        stroke: #e5e5e5;
        stroke-width: 2.5;
        fill: none;
      }

      .${CSS_CLASSES.loading} path {
        stroke: #525252;
        stroke-width: 2.5;
        stroke-linecap: round;
        fill: none;
      }

      @keyframes didit-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      .${CSS_CLASSES.confirmOverlay} {
        display: none;
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 20;
        justify-content: center;
        align-items: center;
        opacity: 0;
        transition: opacity 0.15s ease-out;
      }

      .${CSS_CLASSES.confirmOverlay}.active {
        display: flex;
        opacity: 1;
      }

      .${CSS_CLASSES.confirmBox} {
        background: #fff;
        border-radius: 12px;
        padding: 1.5rem;
        text-align: center;
        max-width: 300px;
        margin: 1rem;
        transform: scale(0.95);
        transition: transform 0.15s ease-out;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        outline: none;
      }

      .${CSS_CLASSES.confirmOverlay}.active .${CSS_CLASSES.confirmBox} {
        transform: scale(1);
      }

      .${CSS_CLASSES.confirmBox} h3 {
        color: #1a1a2e;
        margin: 0 0 0.5rem 0;
        font-size: 1.125rem;
        font-weight: 600;
      }

      .${CSS_CLASSES.confirmBox} p {
        color: #666;
        font-size: 0.875rem;
        margin: 0 0 1.25rem 0;
        line-height: 1.5;
      }

      .didit-confirm-actions {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 1rem;
      }

      .didit-confirm-actions [data-action="continue"] {
        background: #2563eb;
        color: #fff;
        border: none;
        padding: 0.625rem 1.25rem;
        border-radius: 8px;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.15s ease;
      }

      .didit-confirm-actions [data-action="continue"]:hover {
        background: #1d4ed8;
      }

      .didit-confirm-actions [data-action="exit"] {
        background: transparent;
        border: none;
        font-family: inherit;
        font-weight: inherit;
        line-height: inherit;
        color: #666;
        font-size: 0.875rem;
        cursor: pointer;
        padding: 0.625rem;
        transition: color 0.15s ease;
      }

      .didit-confirm-actions [data-action="exit"]:hover {
        color: #1a1a2e;
      }

      .didit-confirm-actions button:focus-visible {
        outline: 2px solid #2567ff;
        outline-offset: 2px;
      }

      @media (max-width: 540px) {
        .${CSS_CLASSES.overlay} {
          padding: 0;
        }

        .${CSS_CLASSES.container} {
          max-width: 100%;
          max-height: 100vh;
          max-height: 100dvh;
          border-radius: 0;
        }

        .${CSS_CLASSES.iframe} {
          height: 100vh;
          height: 100dvh;
          max-height: none;
        }
      }

      /*
       * Once the hosted flow reports its layout (didit:layout), the modal
       * grows to the handoff card on a computer (960 x 660, at most 90% of
       * the window) and follows the flow's content height in a narrow
       * window. Colours are the design system tokens named beside them.
       */
      .${CSS_CLASSES.container}.${CSS_CLASSES.flowSized} {
        --didit-ground: #ffffff; /* site-ground */
        --didit-heading: #1a1a1a; /* c-heading */
        --didit-accent: #2567ff; /* c-accent */
        --didit-hover: rgba(120, 120, 128, 0.08); /* c-hover */
        --didit-close-fill: rgba(0, 0, 0, 0.06);
        --didit-drop: rgba(17, 24, 39, 0.35);
        --didit-ring: rgba(0, 0, 0, 0.06);
        max-width: 500px;
        background: var(--didit-ground);
        box-shadow: 0 30px 80px -24px var(--didit-drop), 0 0 0 1px var(--didit-ring);
      }

      .${CSS_CLASSES.container}.${CSS_CLASSES.flowSized}[data-didit-theme="dark"] {
        --didit-ground: #0b0b0d;
        --didit-heading: #f5f5f7;
        --didit-accent: #4d8bff;
        --didit-hover: rgba(255, 255, 255, 0.06);
        --didit-close-fill: rgba(255, 255, 255, 0.06);
        --didit-drop: rgba(0, 0, 0, 0.55); /* c-shadow-pop, dark */
        --didit-ring: rgba(255, 255, 255, 0.08); /* c-shadow-pop, dark */
      }

      .${CSS_CLASSES.flowSized} .${CSS_CLASSES.iframe} {
        height: var(--didit-flow-height);
        max-height: 90vh;
        max-height: 90dvh;
      }

      .${CSS_CLASSES.closeIcon} {
        display: none;
      }

      .${CSS_CLASSES.flowSized} .${CSS_CLASSES.closeButton} {
        top: 8px;
        right: 8px;
        width: 44px;
        height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        background: var(--didit-close-fill);
        color: var(--didit-heading);
      }

      .${CSS_CLASSES.flowSized}[data-didit-dir="rtl"] .${CSS_CLASSES.closeButton} {
        right: auto;
        left: 8px;
      }

      .${CSS_CLASSES.flowSized} .${CSS_CLASSES.closeButton}:hover,
      .${CSS_CLASSES.flowSized} .${CSS_CLASSES.closeButton}:focus {
        background: var(--didit-close-fill);
        opacity: 1;
      }

      .${CSS_CLASSES.flowSized} .${CSS_CLASSES.closeButton}:hover {
        background-image: linear-gradient(var(--didit-hover), var(--didit-hover));
      }

      .${CSS_CLASSES.flowSized} .${CSS_CLASSES.closeButton}:focus-visible {
        outline: 2px solid var(--didit-accent);
        outline-offset: 2px;
      }

      .${CSS_CLASSES.flowSized} .${CSS_CLASSES.closeIconLegacy} {
        display: none;
      }

      .${CSS_CLASSES.flowSized} .${CSS_CLASSES.closeButton} .${CSS_CLASSES.closeIcon} {
        display: block;
        stroke: currentColor;
        stroke-width: 1.75;
        stroke-linejoin: round;
      }

      /*
       * The exit confirmation is sized in rem, so with a large text size it
       * can be taller than a short flow: it scrolls inside the modal instead
       * of being clipped, and its width and actions follow a larger text size.
       * It never grows wider than the modal: a long word wraps instead.
       */
      .${CSS_CLASSES.flowSized} .${CSS_CLASSES.confirmOverlay} {
        padding: 1rem;
        overflow-y: auto;
      }

      .${CSS_CLASSES.flowSized} .${CSS_CLASSES.confirmBox} {
        min-width: 0;
        max-width: max(300px, 18.75rem);
        margin: auto;
        overflow-wrap: anywhere;
      }

      .${CSS_CLASSES.flowSized} .didit-confirm-actions {
        flex-wrap: wrap;
      }

      @media (min-width: 1024px) {
        .${CSS_CLASSES.container}.${CSS_CLASSES.flowSized} {
          width: 90vw;
          max-width: 960px;
        }

        .${CSS_CLASSES.flowSized} .${CSS_CLASSES.iframe} {
          height: 660px;
        }
      }

      @media (max-width: 540px) {
        .${CSS_CLASSES.container}.${CSS_CLASSES.flowSized} {
          max-width: 100%;
          box-shadow: none;
        }

        .${CSS_CLASSES.flowSized} .${CSS_CLASSES.iframe} {
          height: 100vh;
          height: 100dvh;
          max-height: none;
        }
      }

      .${CSS_CLASSES.embedded} {
        position: relative;
        width: 100%;
        height: 100%;
      }

      .${CSS_CLASSES.embedded} .${CSS_CLASSES.iframe} {
        width: 100%;
        height: 100%;
        max-height: none;
      }

      .${CSS_CLASSES.embedded} .${CSS_CLASSES.loading} {
        border-radius: 0;
      }
    `;

    document.head.appendChild(styles);
  }

  private createDOM(): void {
    this.injectStyles();

    if (this.embedded && this.embeddedContainer) {
      this.createEmbeddedDOM();
      return;
    }
    const t = getTranslations(this.language);

    this.overlay = document.createElement("div");
    this.overlay.id = this.modalId;
    this.overlay.className = CSS_CLASSES.overlay;
    this.overlay.setAttribute("role", "dialog");
    this.overlay.setAttribute("aria-modal", "true");
    this.overlay.setAttribute("aria-label", t.ariaLabelModal);

    this.container = document.createElement("div");
    this.container.className = CSS_CLASSES.container;

    this.loadingEl = document.createElement("div");
    this.loadingEl.className = CSS_CLASSES.loading;
    this.loadingEl.innerHTML = `
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a10 10 0 0 1 10 10" />
      </svg>
    `;

    if (this.config.showCloseButton) {
      const closeBtn = document.createElement("button");
      closeBtn.className = CSS_CLASSES.closeButton;
      closeBtn.setAttribute("aria-label", t.ariaLabelClose);
      closeBtn.innerHTML = `
        <svg class="${CSS_CLASSES.closeIconLegacy}" width="14" height="14" viewBox="0 0 14 14">
          <line x1="1" y1="1" x2="13" y2="13" />
          <line x1="13" y1="1" x2="1" y2="13" />
        </svg>
        <svg class="${CSS_CLASSES.closeIcon}" width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M7 7.03882L17 16.9611" />
          <path d="M7.03968 17L16.9619 7" />
        </svg>
      `;
      closeBtn.addEventListener("click", () => this.handleCloseRequest(closeBtn));
      this.container.appendChild(closeBtn);
    }

    this.iframe = document.createElement("iframe");
    this.iframe.className = CSS_CLASSES.iframe;
    this.iframe.setAttribute("allow", "camera; microphone; fullscreen; autoplay; encrypted-media; geolocation");
    this.iframe.setAttribute("title", t.ariaLabelModal);
    this.iframe.addEventListener("load", () => this.handleIframeLoad());

    this.confirmOverlay = document.createElement("div");
    this.confirmOverlay.className = CSS_CLASSES.confirmOverlay;
    this.confirmOverlay.innerHTML = `
      <div class="${CSS_CLASSES.confirmBox}" role="dialog" aria-modal="true" tabindex="-1"
        aria-labelledby="${this.modalId}-exit-title" aria-describedby="${this.modalId}-exit-message">
        <h3 id="${this.modalId}-exit-title">${t.exitTitle}</h3>
        <p id="${this.modalId}-exit-message">${t.exitMessage}</p>
        <div class="didit-confirm-actions">
          <button type="button" data-action="continue">${t.continueButton}</button>
          <button type="button" data-action="exit">${t.exitButton}</button>
        </div>
      </div>
    `;

    this.confirmOverlay.querySelector('[data-action="continue"]')?.addEventListener("click", () => {
      this.hideConfirmation();
    });
    this.confirmOverlay.querySelector('[data-action="exit"]')?.addEventListener("click", () => {
      this.confirmExit();
    });

    this.container.appendChild(this.loadingEl);
    this.container.appendChild(this.iframe);
    this.container.appendChild(this.confirmOverlay);
    this.overlay.appendChild(this.container);

    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) {
        this.handleCloseRequest();
      }
    });

    this.containerElement.appendChild(this.overlay);
  }

  private createEmbeddedDOM(): void {
    if (!this.embeddedContainer) return;

    this.container = document.createElement("div");
    this.container.id = this.modalId;
    this.container.className = CSS_CLASSES.embedded;

    this.loadingEl = document.createElement("div");
    this.loadingEl.className = CSS_CLASSES.loading;
    this.loadingEl.innerHTML = `
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a10 10 0 0 1 10 10" />
      </svg>
    `;

    this.iframe = document.createElement("iframe");
    this.iframe.className = CSS_CLASSES.iframe;
    this.iframe.setAttribute("allow", "camera; microphone; fullscreen; autoplay; encrypted-media; geolocation");
    this.iframe.setAttribute("title", getTranslations(this.language).ariaLabelModal);
    this.iframe.addEventListener("load", () => this.handleIframeLoad());

    this.container.appendChild(this.loadingEl);
    this.container.appendChild(this.iframe);
    this.embeddedContainer.appendChild(this.container);
  }

  private setupEventListeners(): void {
    // Idempotent: open() calls this every time it presents the modal, but a
    // modal that was already open (or re-opened without an intervening
    // close()) must not accumulate duplicate listeners.
    if (this.boundHandleMessage || this.boundHandleKeydown) {
      return;
    }

    this.boundHandleMessage = this.handleMessage.bind(this);
    window.addEventListener("message", this.boundHandleMessage);

    this.boundHandleKeydown = this.handleKeydown.bind(this);
    document.addEventListener("keydown", this.boundHandleKeydown);

    this.boundHandleFocusin = () => {
      // An iframe can take focus without a focusin event in its parent document.
      // Check after focusout too, once the browser has updated activeElement.
      queueMicrotask(() => {
        if (this.state.showConfirmation && this.isTopmost() && !this.confirmOverlay?.contains(document.activeElement)) {
          this.focusConfirmation();
        }
      });
    };
    document.addEventListener("focusin", this.boundHandleFocusin);
    document.addEventListener("focusout", this.boundHandleFocusin);
    window.addEventListener("blur", this.boundHandleFocusin);
  }

  private removeEventListeners(): void {
    if (this.boundHandleMessage) {
      window.removeEventListener("message", this.boundHandleMessage);
      this.boundHandleMessage = null;
    }
    if (this.boundHandleKeydown) {
      document.removeEventListener("keydown", this.boundHandleKeydown);
      this.boundHandleKeydown = null;
    }
    if (this.boundHandleFocusin) {
      document.removeEventListener("focusin", this.boundHandleFocusin);
      document.removeEventListener("focusout", this.boundHandleFocusin);
      window.removeEventListener("blur", this.boundHandleFocusin);
      this.boundHandleFocusin = null;
    }
  }

  private pushToTop(): void {
    const modals = VerificationModal.openModals;
    const existingIndex = modals.indexOf(this);
    if (existingIndex !== -1) {
      modals.splice(existingIndex, 1);
    }
    modals.push(this);
  }

  private removeFromStack(): void {
    const modals = VerificationModal.openModals;
    const existingIndex = modals.indexOf(this);
    if (existingIndex !== -1) {
      modals.splice(existingIndex, 1);
    }
  }

  private isTopmost(): boolean {
    const modals = VerificationModal.openModals;
    return modals.length > 0 && modals[modals.length - 1] === this;
  }

  private handleMessage(event: MessageEvent): void {
    if (!this.iframe?.src) return;
    if (!isAllowedOrigin(event.origin, this.iframe.src )) {
      return SDKLogger.warn("Received postMessage from unallowed origin:", event.origin);
    }

    // Scope every message to this modal's own iframe. Without this check, a
    // second VerificationModal open at the same time (e.g. a transaction
    // action modal stacked over the verification modal) would also react to
    // postMessages meant for the other iframe.
    if (!this.iframe || event.source !== this.iframe.contentWindow) {
      return;
    }

    SDKLogger.log("Received postMessage:", event.data);

    let messageData: VerificationEvent;
    try {
      if (typeof event.data === "string") {
        messageData = JSON.parse(event.data);
      } else {
        messageData = event.data;
      }
    } catch {
      SDKLogger.warn("Failed to parse postMessage:", event.data);
      return;
    }

    if (messageData.type === "didit:close_request") {
      this.handleCloseRequest();
      return;
    }

    if ((messageData.type as string) === LAYOUT_MESSAGE_TYPE) {
      const layout = this.readFlowLayout(messageData.data);
      if (layout) {
        this.applyFlowLayout(layout);
      } else {
        SDKLogger.warn("Ignoring a layout message without a positive contentHeight:", messageData.data);
      }
      return;
    }

    this.callbacks.onMessage(messageData);
  }

  /**
   * Reads a didit:layout message's data. Without a positive contentHeight the
   * message is ignored; a missing or unknown colorScheme follows the device,
   * and a missing or unknown dir follows the verification URL's language.
   */
  private readFlowLayout(data: unknown): FlowLayout | null {
    const fields = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
    const { contentHeight, colorScheme, dir } = fields;
    if (typeof contentHeight !== "number" || !Number.isFinite(contentHeight) || contentHeight <= 0) {
      return null;
    }
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    return {
      contentHeight: Math.ceil(contentHeight),
      colorScheme: colorScheme === "light" || colorScheme === "dark" ? colorScheme : prefersDark ? "dark" : "light",
      dir: dir === "ltr" || dir === "rtl" ? dir : isRtlLanguage(this.language) ? "rtl" : "ltr"
    };
  }

  /** Embedded mode keeps filling the integrator's host element, whatever the flow reports. */
  private applyFlowLayout(layout: FlowLayout): void {
    if (this.embedded || !this.container) return;
    SDKLogger.log("Flow layout:", layout);
    this.container.classList.add(CSS_CLASSES.flowSized);
    this.container.style.setProperty("--didit-flow-height", `${layout.contentHeight}px`);
    this.container.dataset.diditTheme = layout.colorScheme;
    this.container.dataset.diditDir = layout.dir;
  }

  /** Back to the fixed 500 x 700 modal until the newly loaded flow reports its layout. */
  private resetFlowLayout(): void {
    if (this.embedded || !this.container) return;
    this.container.classList.remove(CSS_CLASSES.flowSized);
    this.container.style.removeProperty("--didit-flow-height");
    delete this.container.dataset.diditTheme;
    delete this.container.dataset.diditDir;
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (!this.state.isOpen) return;

    // When multiple modals are open at once, only the topmost one should
    // react to a keypress aimed at it (e.g. Escape closing a stacked
    // transaction action modal must not also trigger the exit confirmation
    // of the verification modal underneath it).
    if (!this.isTopmost()) return;

    if (event.key === "Tab" && this.state.showConfirmation) {
      const buttons = Array.from(this.confirmOverlay?.querySelectorAll<HTMLButtonElement>("button") ?? []);
      if (buttons.length) {
        event.preventDefault();
        const current = buttons.findIndex((button) => button === document.activeElement);
        const next = event.shiftKey
          ? (current <= 0 ? buttons.length - 1 : current - 1)
          : (current + 1) % buttons.length;
        buttons[next].focus();
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      if (this.state.showConfirmation) {
        this.hideConfirmation();
      } else {
        this.handleCloseRequest();
      }
    }
  }

  private handleIframeLoad(): void {
    if (this.iframe?.src && this.iframe.src !== "about:blank") {
      this.state.isLoading = false;
      this.loadingEl?.classList.add("hidden");
      this.callbacks.onIframeLoad();
    }
  }

  private handleCloseRequest(trigger?: HTMLElement): void {
    if (this.config.showExitConfirmation) {
      this.showConfirmation(trigger);
    } else {
      this.callbacks.onCloseConfirmed();
    }
  }

  private showConfirmation(trigger?: HTMLElement): void {
    if (!this.confirmOverlay || this.state.showConfirmation) return;
    const activeElement = document.activeElement;
    this.confirmationTrigger = trigger ?? (activeElement instanceof HTMLElement && activeElement !== document.body
      ? activeElement
      : this.container?.querySelector<HTMLButtonElement>(`.${CSS_CLASSES.closeButton}`) ?? this.iframe);
    this.state.showConfirmation = true;
    this.confirmOverlay.classList.add("active");
    if (this.iframe) this.iframe.inert = true;
    const close = this.container?.querySelector<HTMLButtonElement>(`.${CSS_CLASSES.closeButton}`);
    if (close) close.inert = true;
    // A confirmation scrolled at a large text size opens again at its title.
    this.confirmOverlay.scrollTop = 0;
    if (this.isTopmost()) this.focusConfirmation();
    this.callbacks.onClose();
  }

  private focusConfirmation(): void {
    this.confirmOverlay?.querySelector<HTMLDivElement>(`.${CSS_CLASSES.confirmBox}`)?.focus({ preventScroll: true });
  }

  private hideConfirmation(restoreFocus = true): void {
    if (!this.state.showConfirmation) return;
    this.state.showConfirmation = false;
    this.confirmOverlay?.classList.remove("active");
    if (this.iframe) this.iframe.inert = false;
    const close = this.container?.querySelector<HTMLButtonElement>(`.${CSS_CLASSES.closeButton}`);
    if (close) close.inert = false;
    const trigger = this.confirmationTrigger;
    this.confirmationTrigger = null;
    if (restoreFocus && this.isTopmost() && trigger?.isConnected) trigger.focus({ preventScroll: true });
  }

  private confirmExit(): void {
    this.hideConfirmation();
    this.callbacks.onCloseConfirmed();
  }

  open(verificationUrl: string): void {
    // Whether this modal already held its scroll lock before this call. Re-opening
    // an already-open instance must not re-capture previousBodyOverflow, or it
    // would record this modal's own "hidden" lock and close() could never restore
    // the real pre-lock value.
    const wasAlreadyOpen = this.state.isOpen;

    this.language = detectLanguageFromUrl(verificationUrl);

    if (!this.overlay && !this.container) {
      this.createDOM();
    }
    // Re-attach listeners every open() (idempotent) since close() now tears
    // them down; this lets the same instance be re-opened without a
    // destroy()/re-create cycle.
    this.setupEventListeners();

    SDKLogger.log("Opening with URL:", verificationUrl);

    this.state.isLoading = true;
    this.hideConfirmation();
    this.loadingEl?.classList.remove("hidden");
    this.resetFlowLayout();

    if (this.iframe) {
      this.iframe.src = verificationUrl;
    }

    this.state.isOpen = true;
    this.pushToTop();

    if (this.embedded) {
      return;
    }

    this.overlay?.classList.add("active");
    // Capture whatever overflow value is currently in effect (which may
    // already be "hidden" because another modal is open) so close() can
    // restore exactly that value instead of clobbering a scroll lock owned
    // by a concurrently open modal. Skip the capture on a re-open: the value
    // in effect is this modal's own lock, and previousBodyOverflow already
    // holds the correct pre-lock value.
    if (!wasAlreadyOpen) {
      this.previousBodyOverflow = document.body.style.overflow;
    }
    document.body.style.overflow = "hidden";
  }

  close(): void {
    SDKLogger.log("Closing");

    this.hideConfirmation(false);
    this.state.isOpen = false;
    this.state.isLoading = true;
    this.state.showConfirmation = false;
    this.removeFromStack();
    this.removeEventListeners();
    this.resetFlowLayout();

    if (this.iframe) {
      this.iframe.src = "about:blank";
    }

    if (this.embedded) {
      return;
    }

    this.overlay?.classList.remove("active");
    document.body.style.overflow = this.previousBodyOverflow ?? "";
    this.previousBodyOverflow = null;
  }

  destroy(): void {
    SDKLogger.log("Destroying");

    this.close();
    this.removeEventListeners();

    if (this.embedded && this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    } else if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }

    this.overlay = null;
    this.container = null;
    this.iframe = null;
    this.loadingEl = null;
    this.confirmOverlay = null;
  }

  isOpen(): boolean {
    return this.state.isOpen;
  }

  isLoading(): boolean {
    return this.state.isLoading;
  }
}
