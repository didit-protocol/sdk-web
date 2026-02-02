import type { DiditSdkConfiguration, VerificationEvent } from "./types";
import { DEFAULT_CONFIG, CSS_CLASSES } from "./constants";
import { SDKLogger, generateModalId, isAllowedOrigin } from "./utils";

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

export class VerificationModal {
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
  private containerElement: HTMLElement;

  private boundHandleMessage: ((event: MessageEvent) => void) | null = null;
  private boundHandleKeydown: ((event: KeyboardEvent) => void) | null = null;

  constructor(configuration: DiditSdkConfiguration | undefined, callbacks: ModalCallbacks) {
    this.modalId = generateModalId();
    this.config = {
      zIndex: configuration?.zIndex ?? DEFAULT_CONFIG.zIndex,
      showCloseButton: configuration?.showCloseButton ?? DEFAULT_CONFIG.showCloseButton,
      showExitConfirmation: configuration?.showExitConfirmation ?? DEFAULT_CONFIG.showExitConfirmation
    };
    this.callbacks = callbacks;
    this.containerElement = configuration?.containerElement ?? document.body;
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
        border-radius: 16px;
        overflow: hidden;
        background: transparent;
      }

      .${CSS_CLASSES.overlay}.active .${CSS_CLASSES.container} {
        transform: scale(1);
      }

      .${CSS_CLASSES.iframe} {
        width: 100%;
        height: 700px;
        border: none;
        display: block;
      }

      .${CSS_CLASSES.closeButton} {
        position: absolute;
        top: 12px;
        right: 12px;
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
        width: 48px;
        height: 48px;
        animation: didit-spin 1s linear infinite;
      }

      .${CSS_CLASSES.loading} circle {
        stroke: #e5e5e5;
        stroke-width: 3;
        fill: none;
      }

      .${CSS_CLASSES.loading} path {
        stroke: #525252;
        stroke-width: 3;
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

      .didit-confirm-actions button {
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

      .didit-confirm-actions button:hover {
        background: #1d4ed8;
      }

      .didit-confirm-actions span {
        color: #666;
        font-size: 0.875rem;
        cursor: pointer;
        padding: 0.625rem;
        transition: color 0.15s ease;
      }

      .didit-confirm-actions span:hover {
        color: #1a1a2e;
      }

      @media (max-width: 540px) {
        .${CSS_CLASSES.overlay} {
          padding: 0;
        }

        .${CSS_CLASSES.container} {
          max-width: 100%;
          max-height: 100vh;
          border-radius: 0;
        }

        .${CSS_CLASSES.iframe} {
          height: 100vh;
        }
      }
    `;

    document.head.appendChild(styles);
  }

  private createDOM(): void {
    this.injectStyles();

    this.overlay = document.createElement("div");
    this.overlay.id = this.modalId;
    this.overlay.className = CSS_CLASSES.overlay;
    this.overlay.setAttribute("role", "dialog");
    this.overlay.setAttribute("aria-modal", "true");
    this.overlay.setAttribute("aria-label", "Didit Verification");

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
      closeBtn.setAttribute("aria-label", "Close verification");
      closeBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 14 14">
          <line x1="1" y1="1" x2="13" y2="13" />
          <line x1="13" y1="1" x2="1" y2="13" />
        </svg>
      `;
      closeBtn.addEventListener("click", () => this.handleCloseRequest());
      this.container.appendChild(closeBtn);
    }

    this.iframe = document.createElement("iframe");
    this.iframe.className = CSS_CLASSES.iframe;
    this.iframe.setAttribute("allow", "camera; microphone; fullscreen; autoplay; encrypted-media; geolocation");
    this.iframe.setAttribute("title", "Didit Verification");
    this.iframe.addEventListener("load", () => this.handleIframeLoad());

    this.confirmOverlay = document.createElement("div");
    this.confirmOverlay.className = CSS_CLASSES.confirmOverlay;
    this.confirmOverlay.innerHTML = `
      <div class="${CSS_CLASSES.confirmBox}">
        <h3>Exit verification?</h3>
        <p>Exiting will end your verification process. Are you sure?</p>
        <div class="didit-confirm-actions">
          <button type="button" data-action="continue">Continue</button>
          <span data-action="exit">Exit</span>
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

  private setupEventListeners(): void {
    this.boundHandleMessage = this.handleMessage.bind(this);
    window.addEventListener("message", this.boundHandleMessage);

    this.boundHandleKeydown = this.handleKeydown.bind(this);
    document.addEventListener("keydown", this.boundHandleKeydown);
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
  }

  private handleMessage(event: MessageEvent): void {
    if (!isAllowedOrigin(event.origin)) {
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

    this.callbacks.onMessage(messageData);
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (!this.state.isOpen) return;

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

  private handleCloseRequest(): void {
    if (this.config.showExitConfirmation) {
      this.showConfirmation();
    } else {
      this.callbacks.onCloseConfirmed();
    }
  }

  private showConfirmation(): void {
    this.state.showConfirmation = true;
    this.confirmOverlay?.classList.add("active");
    this.callbacks.onClose();
  }

  private hideConfirmation(): void {
    this.state.showConfirmation = false;
    this.confirmOverlay?.classList.remove("active");
  }

  private confirmExit(): void {
    this.hideConfirmation();
    this.callbacks.onCloseConfirmed();
  }

  open(verificationUrl: string): void {
    if (!this.overlay) {
      this.createDOM();
      this.setupEventListeners();
    }

    SDKLogger.log("Opening modal with URL:", verificationUrl);

    this.state.isLoading = true;
    this.state.showConfirmation = false;
    this.loadingEl?.classList.remove("hidden");
    this.confirmOverlay?.classList.remove("active");

    if (this.iframe) {
      this.iframe.src = verificationUrl;
    }

    this.state.isOpen = true;
    this.overlay?.classList.add("active");

    document.body.style.overflow = "hidden";
  }

  close(): void {
    SDKLogger.log("Closing modal");

    this.state.isOpen = false;
    this.state.isLoading = true;
    this.state.showConfirmation = false;

    this.overlay?.classList.remove("active");

    if (this.iframe) {
      this.iframe.src = "about:blank";
    }

    document.body.style.overflow = "";
  }

  destroy(): void {
    SDKLogger.log("Destroying modal");

    this.close();
    this.removeEventListeners();

    if (this.overlay && this.overlay.parentNode) {
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
