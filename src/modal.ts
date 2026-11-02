import type { DiditSdkConfiguration, VerificationEvent } from "./types";
import { DEFAULT_CONFIG, CSS_CLASSES, IFRAME_ALLOW, LAYOUT_MESSAGE_TYPE } from "./constants";
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

export type FlowKind = "handoff" | "step";

/** Until the flow reports its first layout the modal waits (hidden) at the size the handoff card needs. */
type ModalKind = FlowKind | "pending";

/** The length of the one animation when the flow moves from the handoff card to a step or back. */
const SIZE_ANIMATION_MS = 300;

/** How long the modal waits for the first layout before it shows at step size, so it can never hang. */
export const FIRST_LAYOUT_TIMEOUT_MS = 3000;

/** The layout the hosted flow reports in a didit:layout message. */
export interface FlowLayout {
  /**
   * What the flow is showing: the computer handoff card, or a step (phone-sized). A flow that does
   * not say gets "step", the size every earlier version of the modal used.
   */
  kind: FlowKind;
  /** Height of the flow's content in CSS pixels, its top bar included. */
  contentHeight: number;
  colorScheme: "light" | "dark";
  dir: "ltr" | "rtl";
}

/** The inline scroll styles a modal overrides to lock the page, as they were before. */
interface PageScrollLock {
  holders: Set<VerificationModal>;
  root: { overflow: string; overscrollBehavior: string };
  /** Only set when the page scrolls its body rather than the window, so the body was locked too. */
  body: { overflow: string } | null;
}

/** The flow's ground (site-ground in the design system), which a full-screen modal paints the page with. */
const FLOW_GROUND = { light: "#ffffff", dark: "#0b0b0d" } as const;

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
  private boundHandleFocusChange: (() => void) | null = null;
  private confirmationFocusTimeout: number | null = null;
  private firstLayoutTimeout: number | null = null;
  private sizeTimeout: number | null = null;

  private embedded: boolean = false;
  private embeddedContainer: HTMLElement | null = null;
  private language: string = "en";

  /** The page's own background colours, kept while a full-screen modal paints over them. */
  private pageBackground: { root: string; body: string } | null = null;
  /**
   * The page's scroll styles from before the first open modal locked them, shared by every open
   * modal: the last one to close gives them back.
   */
  private static pageScrollLock: PageScrollLock | null = null;
  /** The ground below the layout viewport (see showCurtain), while this modal is open. */
  private curtain: HTMLDivElement | null = null;
  private boundPlaceCurtain: (() => void) | null = null;

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
        max-width: 440px;
        height: min(860px, calc(100vh - 2rem));
        height: min(860px, calc(100dvh - 2rem));
        border-radius: 16px;
        overflow: hidden;
        background: transparent;
      }

      .${CSS_CLASSES.overlay}.active .${CSS_CLASSES.container} {
        transform: scale(1);
      }

      .${CSS_CLASSES.iframe} {
        width: 100%;
        height: 100%;
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
        /* The flow's ground, so a phone's loader meets the ground below the viewport without a seam. */
        background: ${FLOW_GROUND.light};
        z-index: 5;
      }

      @media (prefers-color-scheme: dark) {
        .${CSS_CLASSES.loading} {
          background: ${FLOW_GROUND.dark};
        }
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

      /*
       * Steps are phone-sized (440 x 860, above). On a computer the handoff card is wider
       * (board Start-Embedded): 960 x 660 on a window of 1000px or more, never wider than the
       * window less its margin and never taller than 90% of it. In a narrower window the
       * page stacks and the height follows its content (--didit-content-height, set from the
       * flow's layout message). Until the flow reports what it shows, the modal is the handoff
       * card at its final size with the spinner inside it (the flow stays hidden and lays itself
       * out for that size): it never opens small and grows. The first change of kind (a step
       * instead of the handoff, or the person continues on this computer) animates once.
       */
      @media (min-width: 541px) {
        .${CSS_CLASSES.container}[data-didit-kind="handoff"],
        .${CSS_CLASSES.container}[data-didit-kind="pending"] {
          max-width: min(960px, calc(100vw - 2rem));
          height: min(var(--didit-content-height, 660px), calc(100vh * 0.9));
          height: min(var(--didit-content-height, 660px), calc(100dvh * 0.9));
        }

        .${CSS_CLASSES.container}.${CSS_CLASSES.sizeAnimated} {
          transition: max-width 0.25s ease, height 0.25s ease;
        }

        .${CSS_CLASSES.container}[data-didit-kind="pending"] .${CSS_CLASSES.iframe} {
          visibility: hidden;
        }
      }

      /*
       * While pending the card already looks like the first screen (ground, radius, shadow and
       * close button come from the flow-sized rules below, with the device theme); the loader
       * sits inside it on the card's own ground.
       */
      .${CSS_CLASSES.container}[data-didit-kind="pending"] .${CSS_CLASSES.loading} {
        background: transparent;
      }

      .${CSS_CLASSES.container}[data-didit-kind="pending"][data-didit-theme="dark"] .${CSS_CLASSES.loading} circle {
        stroke: rgba(255, 255, 255, 0.16);
      }

      .${CSS_CLASSES.container}[data-didit-kind="pending"][data-didit-theme="dark"] .${CSS_CLASSES.loading} path {
        stroke: #f5f5f7;
      }

      @media (min-width: 1000px) {
        .${CSS_CLASSES.container}[data-didit-kind="handoff"],
        .${CSS_CLASSES.container}[data-didit-kind="pending"] {
          height: min(660px, calc(100vh * 0.9));
          height: min(660px, calc(100dvh * 0.9));
        }
      }

      @media (max-width: 540px) {
        .${CSS_CLASSES.overlay} {
          padding: 0;
        }

        .${CSS_CLASSES.container} {
          max-width: 100%;
          height: 100vh;
          height: 100dvh;
          border-radius: 0;
        }
      }

      /*
       * The flow's ground right below the layout viewport, in the page itself (see showCurtain):
       * on a phone, iOS browsers with their toolbars collapsed show a band of the page there,
       * below every fixed element, the full-screen modal included.
       */
      .${CSS_CLASSES.curtain} {
        display: none;
        position: absolute;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        margin: 0;
        pointer-events: none;
        /* Under the modal where they meet for a frame while the toolbars move, above the page. */
        z-index: ${this.config.zIndex - 1};
        background: ${FLOW_GROUND.light};
      }

      .${CSS_CLASSES.curtain}[data-didit-theme="dark"] {
        background: ${FLOW_GROUND.dark};
      }

      /* The exit confirmation's dimming continues over the ground below the viewport. */
      .${CSS_CLASSES.curtain}[data-didit-dimmed] {
        background-image: linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.5));
      }

      @media (max-width: 540px) {
        .${CSS_CLASSES.curtain} {
          display: block;
        }
      }

      /*
       * The hosted flow's layout message (didit:layout) brings the modal's size
       * (see above), theme and direction. Colours are the design system tokens
       * named beside them.
       */
      .${CSS_CLASSES.container}.${CSS_CLASSES.flowSized} {
        --didit-ground: #ffffff; /* site-ground */
        --didit-heading: #1a1a1a; /* c-heading */
        --didit-accent: #2567ff; /* c-accent */
        --didit-hover: rgba(120, 120, 128, 0.08); /* c-hover */
        --didit-close-fill: rgba(0, 0, 0, 0.06);
        --didit-drop: rgba(17, 24, 39, 0.35);
        --didit-ring: rgba(0, 0, 0, 0.06);
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
        /* Focusing the dialog scrolls it into view start-aligned; this keeps
         * the overlay's top padding visible so the title is never clipped. */
        scroll-margin-top: 1rem;
      }

      .${CSS_CLASSES.flowSized} .didit-confirm-actions {
        flex-wrap: wrap;
      }

      @media (max-width: 540px) {
        .${CSS_CLASSES.container}.${CSS_CLASSES.flowSized} {
          max-width: 100%;
          box-shadow: none;
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
    this.iframe.setAttribute("allow", IFRAME_ALLOW);
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
    this.iframe.setAttribute("allow", IFRAME_ALLOW);
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

    this.boundHandleFocusChange = () => {
      if (!this.state.showConfirmation || !this.isTopmost()) return;
      // An iframe can take focus without a focusin event in its parent document.
      // Wait until its focus transition finishes before moving focus back.
      if (this.confirmationFocusTimeout !== null) window.clearTimeout(this.confirmationFocusTimeout);
      this.confirmationFocusTimeout = window.setTimeout(() => {
        this.confirmationFocusTimeout = null;
        if (this.state.showConfirmation && this.isTopmost() && !this.confirmOverlay?.contains(document.activeElement)) {
          this.focusConfirmation();
        }
      }, 0);
    };
    document.addEventListener("focusin", this.boundHandleFocusChange);
    document.addEventListener("focusout", this.boundHandleFocusChange);
    window.addEventListener("blur", this.boundHandleFocusChange);
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
    if (this.boundHandleFocusChange) {
      document.removeEventListener("focusin", this.boundHandleFocusChange);
      document.removeEventListener("focusout", this.boundHandleFocusChange);
      window.removeEventListener("blur", this.boundHandleFocusChange);
      this.boundHandleFocusChange = null;
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
    const { contentHeight, colorScheme, dir, kind } = fields;
    if (typeof contentHeight !== "number" || !Number.isFinite(contentHeight) || contentHeight <= 0) {
      return null;
    }
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    return {
      kind: kind === "handoff" ? "handoff" : "step",
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
    this.container.dataset.diditTheme = layout.colorScheme;
    this.container.dataset.diditDir = layout.dir;
    // The height the person sees now, before the reported content height can change it.
    const shownHeight = this.container.offsetHeight;
    this.container.style.setProperty("--didit-content-height", `${layout.contentHeight}px`);
    this.matchPageBackground(layout.colorScheme);
    if (this.curtain) this.curtain.dataset.diditTheme = layout.colorScheme;
    this.setModalKind(layout.kind, layout.kind === "handoff" && this.handoffHeight(layout) === shownHeight);
  }

  /** Whether the window is a computer-sized one: a phone is full screen and never waits for a layout. */
  private isPhoneWindow(): boolean {
    return window.matchMedia?.("(max-width: 540px)").matches ?? false;
  }

  /** The height the handoff card takes for a layout, as the size rules above compute it (rounded like offsetHeight). */
  private handoffHeight(layout: FlowLayout): number {
    const cap = window.innerHeight * 0.9;
    return Math.round(Math.min(window.innerWidth >= 1000 ? 660 : layout.contentHeight, cap));
  }

  /**
   * Sets what the modal is sized for. Leaving "pending" shows the modal at its final size with no
   * transition; any later change animates once.
   */
  private setModalKind(kind: ModalKind, sizeUnchanged = false): void {
    if (!this.container) return;
    const previous = this.container.dataset.diditKind;
    if (previous === kind) return;
    if (this.firstLayoutTimeout !== null && kind !== "pending") {
      window.clearTimeout(this.firstLayoutTimeout);
      this.firstLayoutTimeout = null;
    }
    // Every change of kind animates, the pending card included (it is on screen), and only for the
    // length of the change, so resizing the window never lags behind.
    // Pending already is the handoff card: a handoff first layout of the same size moves nothing,
    // while a different reported height (a narrow window) animates the correction once.
    const staysPut = previous === "pending" && kind === "handoff" && sizeUnchanged;
    if (previous !== undefined && !staysPut) this.animateSizeOnce();
    this.container.dataset.diditKind = kind;
    // The final size is in place before the loader goes; a flow still loading keeps its loader.
    if (previous === "pending" && !this.state.isLoading) this.loadingEl?.classList.add("hidden");
  }

  private animateSizeOnce(): void {
    this.container?.classList.add(CSS_CLASSES.sizeAnimated);
    if (this.sizeTimeout !== null) window.clearTimeout(this.sizeTimeout);
    this.sizeTimeout = window.setTimeout(() => {
      this.sizeTimeout = null;
      this.container?.classList.remove(CSS_CLASSES.sizeAnimated);
    }, SIZE_ANIMATION_MS);
  }

  /** A flow that reports no layout (an older one) still shows, at step size, after a short wait. */
  private waitForFirstLayout(): void {
    if (!this.container) return;
    // The card looks like the first screen from the first frame, in the device's theme.
    this.container.classList.add(CSS_CLASSES.flowSized);
    this.container.dataset.diditTheme = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    this.setModalKind("pending");
    this.firstLayoutTimeout = window.setTimeout(() => {
      this.firstLayoutTimeout = null;
      // A flow that never reported is an older one that paints itself: no card look around it.
      this.container?.classList.remove(CSS_CLASSES.flowSized);
      delete this.container?.dataset.diditTheme;
      this.setModalKind("step");
    }, FIRST_LAYOUT_TIMEOUT_MS);
  }

  /**
   * On a phone Safari paints the bottom edge of the screen with the page's own background, past
   * any fixed overlay, and shows it when the keyboard moves the page. A full-screen modal lends
   * the page its ground colour while it is open, so no strip of the host page shows around it.
   */
  private matchPageBackground(colorScheme: FlowLayout["colorScheme"]): void {
    if (!window.matchMedia?.("(max-width: 540px)").matches) return;
    const root = document.documentElement;
    this.pageBackground ??= { root: root.style.backgroundColor, body: document.body.style.backgroundColor };
    const ground = FLOW_GROUND[colorScheme];
    root.style.backgroundColor = ground;
    document.body.style.backgroundColor = ground;
  }

  private restorePageBackground(): void {
    if (!this.pageBackground) return;
    document.documentElement.style.backgroundColor = this.pageBackground.root;
    document.body.style.backgroundColor = this.pageBackground.body;
    this.pageBackground = null;
  }

  /**
   * Stops the page scrolling under the modal. The lock is on the root element: Chrome for iOS keeps
   * scrolling a page whose body alone is `overflow: hidden` (a swipe over the modal scrolls the page
   * and toggles the browser's toolbars), and stops only when the root element is. A page that
   * scrolls its body instead of the window has its body locked too. The first modal to open keeps
   * the page's own values and the last one to close gives them back.
   */
  private lockPageScroll(): void {
    const lock = VerificationModal.pageScrollLock;
    if (lock) {
      lock.holders.add(this);
      return;
    }
    const root = document.documentElement;
    const body = document.body;
    // The body's overflow is the viewport's only while the root's is visible; otherwise a body with
    // an overflow of its own is a scroll container. Locking a body that is not one would clip the page
    // to the body's box.
    const clips = (overflow: string) => overflow !== "" && overflow !== "visible";
    const bodyScrollsItself =
      clips(window.getComputedStyle(root).overflowY) && clips(window.getComputedStyle(body).overflowY);
    VerificationModal.pageScrollLock = {
      holders: new Set([this]),
      root: { overflow: root.style.overflow, overscrollBehavior: root.style.overscrollBehavior },
      body: bodyScrollsItself ? { overflow: body.style.overflow } : null
    };
    root.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    if (bodyScrollsItself) body.style.overflow = "hidden";
  }

  private unlockPageScroll(): void {
    const lock = VerificationModal.pageScrollLock;
    if (!lock || !lock.holders.delete(this) || lock.holders.size > 0) return;
    VerificationModal.pageScrollLock = null;
    const root = document.documentElement;
    root.style.overflow = lock.root.overflow;
    root.style.overscrollBehavior = lock.root.overscrollBehavior;
    if (lock.body) document.body.style.overflow = lock.body.overflow;
  }

  /**
   * On a phone, Chrome for iOS (and the other iOS browsers built on WebKit's web view) shows a band
   * of the page below the layout viewport while its toolbars are collapsed: the home indicator's
   * area, and more while the toolbars move. Fixed elements end at the layout viewport, so the
   * full-screen modal cannot cover it and the host page's own content showed under the flow. The
   * curtain is part of the page instead: right below the viewport, in the flow's ground, so that band
   * shows the modal's ground. The page cannot scroll while the modal is open (lockPageScroll), and the
   * curtain follows the viewport when it resizes. Only phone-sized windows draw it (see the styles).
   */
  private showCurtain(): void {
    if (!this.curtain) {
      const curtain = document.createElement("div");
      curtain.className = CSS_CLASSES.curtain;
      curtain.setAttribute("aria-hidden", "true");
      document.body.appendChild(curtain);
      this.curtain = curtain;
      this.boundPlaceCurtain = () => this.placeCurtain();
      window.addEventListener("resize", this.boundPlaceCurtain);
      window.addEventListener("scroll", this.boundPlaceCurtain);
      window.visualViewport?.addEventListener("resize", this.boundPlaceCurtain);
    }
    // The device's theme until the newly loaded flow reports its own (applyFlowLayout).
    this.curtain.dataset.diditTheme = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    this.placeCurtain();
  }

  /** Puts the curtain's top at the bottom of the layout viewport, whatever its containing block is. */
  private placeCurtain(): void {
    const curtain = this.curtain;
    if (!curtain) return;
    curtain.style.top = "0px";
    curtain.style.left = "0px";
    // At 0, 0 the curtain's box starts at its containing block's corner (the page's, or a positioned
    // body's), in viewport coordinates: the offset that brings its top to the viewport's bottom edge.
    const origin = curtain.getBoundingClientRect();
    curtain.style.top = `${window.innerHeight - origin.top}px`;
    curtain.style.left = `${-origin.left}px`;
  }

  private removeCurtain(): void {
    if (this.boundPlaceCurtain) {
      window.removeEventListener("resize", this.boundPlaceCurtain);
      window.removeEventListener("scroll", this.boundPlaceCurtain);
      window.visualViewport?.removeEventListener("resize", this.boundPlaceCurtain);
      this.boundPlaceCurtain = null;
    }
    this.curtain?.remove();
    this.curtain = null;
  }

  /** Back to the neutral look until the newly loaded flow reports its theme and direction. */
  private resetFlowLayout(): void {
    if (this.embedded || !this.container) return;
    this.restorePageBackground();
    this.container.classList.remove(CSS_CLASSES.flowSized, CSS_CLASSES.sizeAnimated);
    delete this.container.dataset.diditTheme;
    delete this.container.dataset.diditDir;
    delete this.container.dataset.diditKind;
    this.container.style.removeProperty("--didit-content-height");
    if (this.firstLayoutTimeout !== null) {
      window.clearTimeout(this.firstLayoutTimeout);
      this.firstLayoutTimeout = null;
    }
    if (this.sizeTimeout !== null) {
      window.clearTimeout(this.sizeTimeout);
      this.sizeTimeout = null;
    }
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
      // A modal still waiting for its first layout keeps the loader over the hidden flow.
      if (this.container?.dataset.diditKind !== "pending") this.loadingEl?.classList.add("hidden");
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
    this.curtain?.setAttribute("data-didit-dimmed", "");
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
    if (this.confirmationFocusTimeout !== null) {
      window.clearTimeout(this.confirmationFocusTimeout);
      this.confirmationFocusTimeout = null;
    }
    if (!this.state.showConfirmation) return;
    this.state.showConfirmation = false;
    this.confirmOverlay?.classList.remove("active");
    this.curtain?.removeAttribute("data-didit-dimmed");
    if (this.iframe) this.iframe.inert = false;
    const close = this.container?.querySelector<HTMLButtonElement>(`.${CSS_CLASSES.closeButton}`);
    if (close) close.inert = false;
    const trigger = this.confirmationTrigger;
    this.confirmationTrigger = null;
    if (restoreFocus && this.isTopmost() && trigger?.isConnected) {
      if (trigger === this.iframe) {
        // Firefox needs a browser task to reactivate an inert cross-origin frame.
        this.confirmationFocusTimeout = window.setTimeout(() => {
          this.confirmationFocusTimeout = null;
          if (this.state.isOpen && !this.state.showConfirmation && this.isTopmost() && trigger.isConnected) {
            trigger.focus({ preventScroll: true });
          }
        }, 0);
      } else {
        trigger.focus({ preventScroll: true });
      }
    }
  }

  private confirmExit(): void {
    this.hideConfirmation();
    this.callbacks.onCloseConfirmed();
  }

  open(verificationUrl: string): void {
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
    if (!this.embedded && !this.isPhoneWindow()) this.waitForFirstLayout();

    if (this.iframe) {
      this.iframe.src = verificationUrl;
    }

    this.state.isOpen = true;
    this.pushToTop();

    if (this.embedded) {
      return;
    }

    this.overlay?.classList.add("active");
    // Idempotent: a re-open of a modal that is still open keeps its one hold on the lock, so
    // close() still gives the page back the values it had before any modal opened.
    this.lockPageScroll();
    this.showCurtain();
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
    this.removeCurtain();
    this.unlockPageScroll();
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
