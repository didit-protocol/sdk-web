import type { DiditSdkConfiguration, VerificationEvent } from "./types";
import { DEFAULT_CONFIG, CSS_CLASSES, IFRAME_ALLOW, LAYOUT_MESSAGE_TYPE } from "./constants";
import { SDKLogger, generateModalId, isAllowedOrigin, detectLanguageFromUrl, isRtlLanguage } from "./utils";
import { getTranslations, type ModalTranslations } from "./translations";

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

/**
 * What a caller other than `startVerification` changes in the frame host. Every field is optional and
 * the defaults are the verification flow's own behaviour, so a modal built without options is unchanged.
 */
export interface FrameHostOptions {
  /** The iframe `allow` list; defaults to the verification flow's {@link IFRAME_ALLOW}. */
  iframeAllow?: string;
  /** The language of the modal's own text, when it is not read from the frame URL's path. */
  language?: string;
  /** The modal's own text (labels and exit confirmation) for a language; defaults to the verification texts. */
  translations?: (language: string) => ModalTranslations;
  /** The iframe `referrerpolicy`; none is set by default. */
  referrerPolicy?: ReferrerPolicy;
  /** The element an embedded frame renders in, for a caller that holds the element rather than an id. */
  embeddedElement?: HTMLElement;
  /**
   * Whether a message from `origin` may be read, given the frame's current `src`. Defaults to
   * {@link isAllowedOrigin}. It runs before anything else, and the message's source window must still be
   * this frame's window.
   */
  isTrustedOrigin?: (origin: string, iframeSrc: string) => boolean;
  /**
   * Sees every message (origin and source already checked, JSON already parsed) before the host's own
   * handling; returning true means it consumed the message.
   */
  interceptMessage?: (message: unknown, event: MessageEvent) => boolean;
  /**
   * Embedded only. Makes the frame's height follow the flow's reported `contentHeight` when the host element has no
   * height of its own (the host grows like a block), capped by `maxHeight`; with `height` the frame keeps that
   * height. Without this option an embedded frame always fills the host element.
   */
  embeddedHeight?: { height?: number | string; maxHeight?: number };
  /** Called when the browser fires an `error` event on the frame (some browsers do when a frame cannot be loaded). */
  onIframeError?: () => void;
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
  root: { overflow: string; overscrollBehavior: string; scrollbarGutter: string; paddingRight: string };
  /** Only set when the page scrolls its body rather than the window, so the body was locked too. */
  body: { overflow: string } | null;
}

/** The page's background colours before any modal lent it a ground, and each modal's ground. */
interface PageBackground {
  saved: { root: string; body: string };
  grounds: Map<VerificationModal, FlowLayout["colorScheme"]>;
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
  private frameOptions: FrameHostOptions;
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

  /**
   * The page's own background colours, kept while full-screen modals lend it their ground, shared by
   * every open modal: the topmost one's ground shows and the last one to give it back restores them.
   */
  private static pageBackground: PageBackground | null = null;
  /**
   * The page's scroll styles from before the first open modal locked them, shared by every open
   * modal: the last one to close gives them back.
   */
  private static pageScrollLock: PageScrollLock | null = null;
  /** The ground below the layout viewport (see showCurtain), while this modal is open. */
  private curtain: HTMLDivElement | null = null;
  private boundPlaceCurtain: (() => void) | null = null;
  /** Embedded height: null until measured, then whether the host grows with the frame (see applyEmbeddedHeight). */
  private embeddedFollowsContent: boolean | null = null;
  /** The element that had focus when the modal opened; the person gets back to it when it closes. */
  private opener: HTMLElement | null = null;
  /** The "could not load" card over the frame, while there is one (see showLoadError). */
  private loadError: HTMLDivElement | null = null;

  constructor(
    configuration: DiditSdkConfiguration | undefined,
    callbacks: ModalCallbacks,
    frameOptions: FrameHostOptions = {}
  ) {
    this.modalId = generateModalId();
    this.config = {
      zIndex: configuration?.zIndex ?? DEFAULT_CONFIG.zIndex,
      showCloseButton: configuration?.showCloseButton ?? DEFAULT_CONFIG.showCloseButton,
      showExitConfirmation: configuration?.showExitConfirmation ?? DEFAULT_CONFIG.showExitConfirmation
    };
    this.callbacks = callbacks;
    this.frameOptions = frameOptions;
    this.containerElement = configuration?.containerElement ?? document.body;
    this.embedded = configuration?.embedded ?? false;
    if (this.embedded && frameOptions.embeddedElement) {
      this.embeddedContainer = frameOptions.embeddedElement;
    } else if (this.embedded && configuration?.embeddedContainerId) {
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

      /* The dialog itself takes focus when it opens; its ring is the frame's, not the backdrop's. */
      .${CSS_CLASSES.overlay}:focus {
        outline: none;
      }

      /* Focus sentinels keep Tab inside the dialog; they are focusable but take no room. */
      .${CSS_CLASSES.focusSentinel} {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: 0;
        padding: 0;
        overflow: hidden;
        opacity: 0;
        pointer-events: none;
      }

      .${CSS_CLASSES.container} {
        position: relative;
        box-sizing: border-box;
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

      /*
       * The frame fills its container's content box exactly: its box is pinned on every side, so a
       * host page's own iframe rules (a border, a margin, an inline baseline gap, a max-width) cannot
       * leave a strip of the overlay or the page showing next to it.
       */
      .${CSS_CLASSES.iframe} {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        left: 0;
        box-sizing: border-box;
        display: block;
        width: 100%;
        height: 100%;
        min-width: 0;
        max-width: none;
        margin: 0;
        padding: 0;
        border: 0;
        vertical-align: top;
      }

      /* A host's global iframe height rules (min-height, max-height) must not undo the pinned box. */
      .${CSS_CLASSES.container} > .${CSS_CLASSES.iframe} {
        min-height: 0;
        max-height: none;
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

      /*
       * The frame never loaded (blocked, offline): its message and a retry, over the frame's place. The ground and
       * the text follow the flow's theme when it is known and the device's otherwise.
       */
      .${CSS_CLASSES.loadError} {
        position: absolute;
        inset: 0;
        z-index: 15;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        padding: 1.5rem;
        text-align: center;
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
        font-size: 0.9375rem;
        line-height: 1.5;
        background: #ffffff;
        color: #1a1a1a;
      }

      @media (prefers-color-scheme: dark) {
        .${CSS_CLASSES.loadError} {
          background: ${FLOW_GROUND.dark};
          color: #f5f5f7;
        }
      }

      .${CSS_CLASSES.container}[data-didit-theme="light"] .${CSS_CLASSES.loadError} {
        background: #ffffff;
        color: #1a1a1a;
      }

      .${CSS_CLASSES.container}[data-didit-theme="dark"] .${CSS_CLASSES.loadError} {
        background: ${FLOW_GROUND.dark};
        color: #f5f5f7;
      }

      .${CSS_CLASSES.loadError} p {
        margin: 0;
        max-width: 22rem;
      }

      .${CSS_CLASSES.loadError} button {
        border: none;
        border-radius: 8px;
        padding: 0.625rem 1.25rem;
        font: inherit;
        font-weight: 500;
        cursor: pointer;
        background: #2567ff;
        color: #ffffff;
      }

      .${CSS_CLASSES.loadError} button + button {
        background: transparent;
        color: inherit;
        opacity: 0.8;
      }

      .${CSS_CLASSES.loadError} button:focus-visible {
        outline: 2px solid #2567ff;
        outline-offset: 2px;
      }

      .${CSS_CLASSES.embedded} .${CSS_CLASSES.loadError} {
        position: relative;
        inset: auto;
        height: 100%;
        min-height: 12rem;
      }

      .${CSS_CLASSES.embedded} {
        position: relative;
        box-sizing: border-box;
        display: block;
        width: 100%;
        height: 100%;
      }

      /* The host's element owns the size: the frame stays in the flow and fills it. */
      .${CSS_CLASSES.embedded} .${CSS_CLASSES.iframe} {
        position: static;
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
    const t = this.translations();

    this.overlay = document.createElement("div");
    this.overlay.id = this.modalId;
    this.overlay.className = CSS_CLASSES.overlay;
    this.overlay.setAttribute("role", "dialog");
    this.overlay.setAttribute("aria-modal", "true");
    this.overlay.setAttribute("aria-label", t.ariaLabelModal);
    this.overlay.tabIndex = -1;

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
    this.applyIframeAttributes(this.iframe);
    this.iframe.setAttribute("title", t.ariaLabelModal);
    this.iframe.addEventListener("load", () => this.handleIframeLoad());
    this.iframe.addEventListener("error", () => this.frameOptions.onIframeError?.());

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
    // Without a close button the frame is the first stop, and Shift+Tab out of it cannot be heard from
    // this document: a leading sentinel catches it. With the button, the keydown handler does.
    if (!this.config.showCloseButton) this.overlay.appendChild(this.createFocusSentinel("start"));
    this.overlay.appendChild(this.container);
    this.overlay.appendChild(this.createFocusSentinel("end"));

    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) {
        this.handleCloseRequest();
      }
    });

    this.containerElement.appendChild(this.overlay);
  }

  /**
   * A frame is one tab stop from this page's side, so Tab out of its last element would walk past
   * the dialog into the page behind. The sentinel sits right after the dialog's content: landing on
   * it sends focus back to the first stop. The way back (Shift+Tab on the first stop) is the
   * keydown handler's, because the first stop is in this document.
   */
  private createFocusSentinel(edge: "start" | "end"): HTMLSpanElement {
    const sentinel = document.createElement("span");
    sentinel.className = CSS_CLASSES.focusSentinel;
    sentinel.tabIndex = 0;
    sentinel.setAttribute("aria-hidden", "true");
    sentinel.addEventListener("focus", () => {
      const stops = this.tabStops();
      const target = edge === "start" ? stops[stops.length - 1] : stops[0];
      (target ?? this.overlay)?.focus({ preventScroll: true });
    });
    return sentinel;
  }

  /** The elements Tab visits inside the dialog, in order: the exit confirmation's buttons while it shows, else the close button and the frame. */
  private tabStops(): HTMLElement[] {
    if (this.state.showConfirmation) {
      return Array.from(this.confirmOverlay?.querySelectorAll<HTMLElement>("button") ?? []);
    }
    const close = this.container?.querySelector<HTMLElement>(`.${CSS_CLASSES.closeButton}`);
    // While a card shows (could not load, refused), its buttons stand where the frame was and the frame is out of reach.
    if (this.loadError) return Array.from(this.loadError.querySelectorAll<HTMLElement>("button"));
    return [close, this.iframe].filter((el): el is HTMLElement => el instanceof HTMLElement);
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
    this.applyIframeAttributes(this.iframe);
    this.iframe.setAttribute("title", this.translations().ariaLabelModal);
    this.iframe.addEventListener("load", () => this.handleIframeLoad());
    this.iframe.addEventListener("error", () => this.frameOptions.onIframeError?.());

    this.container.appendChild(this.loadingEl);
    this.container.appendChild(this.iframe);
    this.embeddedContainer.appendChild(this.container);
  }

  private translations(): ModalTranslations {
    return (this.frameOptions.translations ?? getTranslations)(this.language);
  }

  private applyIframeAttributes(iframe: HTMLIFrameElement): void {
    iframe.setAttribute("allow", this.frameOptions.iframeAllow ?? IFRAME_ALLOW);
    if (this.frameOptions.referrerPolicy) iframe.referrerPolicy = this.frameOptions.referrerPolicy;
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
    const isTrustedOrigin = this.frameOptions.isTrustedOrigin ?? isAllowedOrigin;
    if (!isTrustedOrigin(event.origin, this.iframe.src )) {
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

    if (this.frameOptions.interceptMessage?.(messageData, event)) return;

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
    if (this.embedded) {
      this.applyEmbeddedHeight(layout.contentHeight);
      return;
    }
    if (!this.container) return;
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

  /**
   * Embedded height (see FrameHostOptions.embeddedHeight). Whether the host fixed its own height is measured once:
   * with the frame at 0 the host's height is its own; if the frame at the content height makes it taller, the host
   * follows its content and so does the frame. A host with an explicit height (or one the frame cannot grow) keeps it.
   */
  private applyEmbeddedHeight(contentHeight: number): void {
    const options = this.frameOptions.embeddedHeight;
    const frame = this.container;
    const host = this.embeddedContainer;
    if (!options || !frame || !host) return;
    if (options.height !== undefined) {
      frame.style.height = typeof options.height === "number" ? `${options.height}px` : options.height;
      return;
    }
    const wanted = options.maxHeight ? Math.min(contentHeight, options.maxHeight) : contentHeight;
    if (this.embeddedFollowsContent === null) {
      frame.style.height = "0px";
      const without = host.offsetHeight;
      frame.style.height = `${wanted}px`;
      this.embeddedFollowsContent = host.offsetHeight > without;
    }
    if (this.embeddedFollowsContent) frame.style.height = `${wanted}px`;
    else frame.style.removeProperty("height");
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
    VerificationModal.pageBackground ??= {
      saved: { root: document.documentElement.style.backgroundColor, body: document.body.style.backgroundColor },
      grounds: new Map()
    };
    VerificationModal.pageBackground.grounds.set(this, colorScheme);
    VerificationModal.paintPageBackground();
  }

  private restorePageBackground(): void {
    const background = VerificationModal.pageBackground;
    if (!background?.grounds.delete(this)) return;
    if (background.grounds.size > 0) {
      VerificationModal.paintPageBackground();
      return;
    }
    VerificationModal.pageBackground = null;
    document.documentElement.style.backgroundColor = background.saved.root;
    document.body.style.backgroundColor = background.saved.body;
  }

  /** The page shows the ground of the topmost open modal that lends one. */
  private static paintPageBackground(): void {
    const background = VerificationModal.pageBackground;
    if (!background) return;
    const lender = [...VerificationModal.openModals].reverse().find((modal) => background.grounds.has(modal));
    const colorScheme = lender ? background.grounds.get(lender) : [...background.grounds.values()].pop();
    if (!colorScheme) return;
    document.documentElement.style.backgroundColor = FLOW_GROUND[colorScheme];
    document.body.style.backgroundColor = FLOW_GROUND[colorScheme];
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
    // A classic scrollbar leaves with the overflow and the page would jump wider: its width is kept
    // (jsdom and overlay scrollbars have none, and then nothing is added).
    const scrollbarWidth = root.clientWidth > 0 ? Math.max(0, window.innerWidth - root.clientWidth) : 0;
    VerificationModal.pageScrollLock = {
      holders: new Set([this]),
      root: {
        overflow: root.style.overflow,
        overscrollBehavior: root.style.overscrollBehavior,
        scrollbarGutter: root.style.getPropertyValue("scrollbar-gutter"),
        paddingRight: root.style.paddingRight
      },
      body: bodyScrollsItself ? { overflow: body.style.overflow } : null
    };
    const paddingRight = scrollbarWidth > 0 ? window.getComputedStyle(root).paddingRight : "";
    root.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    if (bodyScrollsItself) body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      if (typeof CSS !== "undefined" && CSS.supports?.("scrollbar-gutter", "stable")) {
        root.style.setProperty("scrollbar-gutter", "stable");
      } else {
        root.style.paddingRight =
          paddingRight && paddingRight !== "0px" ? `calc(${paddingRight} + ${scrollbarWidth}px)` : `${scrollbarWidth}px`;
      }
    }
  }

  private unlockPageScroll(): void {
    const lock = VerificationModal.pageScrollLock;
    if (!lock || !lock.holders.delete(this) || lock.holders.size > 0) return;
    VerificationModal.pageScrollLock = null;
    const root = document.documentElement;
    root.style.overflow = lock.root.overflow;
    root.style.overscrollBehavior = lock.root.overscrollBehavior;
    if (lock.root.scrollbarGutter) root.style.setProperty("scrollbar-gutter", lock.root.scrollbarGutter);
    else root.style.removeProperty("scrollbar-gutter");
    if (lock.root.paddingRight) root.style.paddingRight = lock.root.paddingRight;
    else root.style.removeProperty("padding-right");
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
    if (this.embedded && this.container && this.frameOptions.embeddedHeight) {
      this.embeddedFollowsContent = null;
      this.container.style.removeProperty("height");
    }
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

    if (event.key === "Tab" && event.shiftKey && !this.embedded) {
      // Shift+Tab on the dialog itself or on its first stop wraps to the last stop, never out to the page behind.
      const stops = this.tabStops();
      const active = document.activeElement;
      if (stops.length && (active === this.overlay || active === stops[0])) {
        event.preventDefault();
        stops[stops.length - 1].focus({ preventScroll: true });
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
    this.confirmationTrigger = trigger ?? (activeElement instanceof HTMLElement && activeElement !== document.body && activeElement !== this.overlay
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
    const wasOpen = this.state.isOpen;
    const previouslyFocused = document.activeElement;
    this.language = this.frameOptions.language ?? detectLanguageFromUrl(verificationUrl);

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
    this.hideLoadError();
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
    if (!wasOpen) {
      this.opener = previouslyFocused instanceof HTMLElement && previouslyFocused !== document.body ? previouslyFocused : null;
      // Focus moves into the dialog: Tab and Shift+Tab stay inside it (see createFocusSentinel).
      this.overlay?.focus({ preventScroll: true });
    }
  }

  close(): void {
    SDKLogger.log("Closing");

    this.hideConfirmation(false);
    this.hideLoadError();
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
    this.restoreOpenerFocus();
  }

  /** Back to the element that had focus when the modal opened, if it is still in the page. */
  private restoreOpenerFocus(): void {
    const opener = this.opener;
    this.opener = null;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
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

  /**
   * The frame's document never loaded: the frame is blanked and hidden and a message with a retry button and a
   * close button takes its place. `onRetry` runs when the person presses Try again (the caller then opens a fresh
   * frame); `onClose` when they press Close.
   */
  showLoadError(onRetry: () => void, onClose: () => void): void {
    if (!this.container || !this.iframe) return;
    const t = this.translations();
    this.iframe.src = "about:blank";
    this.iframe.inert = true;
    this.iframe.style.display = "none";
    this.mountCard(t.loadErrorMessage ?? "We couldn't load this page. Check your connection and try again.", [
      { label: t.retryButton ?? "Try again", run: onRetry },
      { label: t.closeButton ?? "Close", run: onClose }
    ]);
  }

  /**
   * The link cannot be opened here (the service refused it, so no frame was ever created): the dialog (or the
   * inline container) shows the refusal and a Close control, and nothing else. The caller has already told the
   * host; `onClose` only ends what is on screen.
   */
  showRefusal(onClose: () => void): void {
    this.language = this.frameOptions.language ?? (typeof navigator !== "undefined" && navigator.language ? navigator.language : "en");
    const previouslyFocused = document.activeElement;
    if (!this.overlay && !this.container) this.createDOM();
    this.setupEventListeners();
    this.state.isOpen = true;
    this.pushToTop();
    // No frame exists for a refused link: its element goes, so nothing of it is left in the page.
    this.iframe?.remove();
    this.iframe = null;
    if (!this.embedded) {
      this.overlay?.classList.add("active");
      this.lockPageScroll();
      this.showCurtain();
      this.opener = previouslyFocused instanceof HTMLElement && previouslyFocused !== document.body ? previouslyFocused : null;
    }
    const t = this.translations();
    this.mountCard(t.refusalMessage ?? "This link can't be opened here.", [{ label: t.closeButton ?? "Close", run: onClose }]);
  }

  /** The card over the frame's place: a message and its buttons; the first button takes focus. */
  private mountCard(text: string, actions: Array<{ label: string; run: () => void }>): void {
    const host = this.container;
    if (!host) return;
    this.hideLoadError();
    const card = document.createElement("div");
    card.className = CSS_CLASSES.loadError;
    const message = document.createElement("p");
    message.setAttribute("role", "alert");
    message.textContent = text;
    card.appendChild(message);
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("click", () => action.run());
      card.appendChild(button);
    }
    this.loadingEl?.classList.add("hidden");
    host.appendChild(card);
    this.loadError = card;
    card.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  }

  /** Removes the "could not load" card and gives the frame back; a no-op without one. */
  private hideLoadError(): void {
    if (!this.loadError) return;
    this.loadError.remove();
    this.loadError = null;
    if (this.iframe) {
      this.iframe.inert = this.state.showConfirmation;
      this.iframe.style.removeProperty("display");
    }
  }

  /** Leaves the "could not load" state before a retry opens a fresh frame. */
  clearLoadError(): void {
    this.hideLoadError();
    this.loadingEl?.classList.remove("hidden");
  }

  /** The frame's window, for a caller that posts to it (always with an exact target origin). */
  frameWindow(): Window | null {
    return this.iframe?.contentWindow ?? null;
  }

  isOpen(): boolean {
    return this.state.isOpen;
  }

  isLoading(): boolean {
    return this.state.isLoading;
  }
}
