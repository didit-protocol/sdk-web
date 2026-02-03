import type {
  DiditSdkState,
  DiditSdkConfiguration,
  VerificationResult,
  VerificationCallback,
  StateChangeCallback,
  EventCallback,
  VerificationEvent,
  SessionData,
  VerificationStatus,
  StartVerificationOptions
} from "./types";

import { VerificationModal } from "./modal";
import { DEFAULT_CONFIG } from "./constants";
import { SDKLogger, createVerificationError } from "./utils";

export class DiditSdk {
  private static _instance: DiditSdk | null = null;

  public static get shared(): DiditSdk {
    if (!DiditSdk._instance) {
      DiditSdk._instance = new DiditSdk();
    }
    return DiditSdk._instance;
  }

  public static reset(): void {
    if (DiditSdk._instance) {
      DiditSdk._instance.destroy();
      DiditSdk._instance = null;
    }
  }

  private _state: DiditSdkState = "idle";
  private _configuration: DiditSdkConfiguration | undefined;
  private _sessionId: string | undefined;
  private _url: string | undefined;
  private _modal: VerificationModal | null = null;
  private _errorMessage: string | undefined;

  public onComplete: VerificationCallback | undefined;
  public onStateChange: StateChangeCallback | undefined;
  public onEvent: EventCallback | undefined;

  public get state(): DiditSdkState {
    return this._state;
  }

  public get configuration(): DiditSdkConfiguration | undefined {
    return this._configuration;
  }

  public get isPresented(): boolean {
    return this._modal?.isOpen() ?? false;
  }

  public get errorMessage(): string | undefined {
    return this._errorMessage;
  }

  private constructor() {
    SDKLogger.log("DiditSdk initialized");
  }

  public async startVerification(options: StartVerificationOptions): Promise<void> {
    const config = options.configuration;
    this._configuration = config;

    SDKLogger.isEnabled = config?.loggingEnabled ?? DEFAULT_CONFIG.loggingEnabled;

    SDKLogger.log("Starting verification with options:", options);
    if (this._modal) {
      this._modal.destroy();
      this._modal = null;
    }
    this._modal = new VerificationModal(config, {
      onClose: () => this.handleModalClose(),
      onCloseConfirmed: () => this.handleModalCloseConfirmed(),
      onMessage: (event) => this.handleVerificationEvent(event),
      onIframeLoad: () => this.handleIframeLoad()
    });

    try {
      const { url } = options;

      if (!url || typeof url !== "string") {
        throw new Error("Invalid options: url is required");
      }

      this._url = url;
      this.setState("loading");

      this.emitInternalEvent("didit:started", {});

      this._modal?.open(this._url);
    } catch (error) {
      this.handleError(error);
    }
  }

  public close(): void {
    SDKLogger.log("Closing verification programmatically");
    this.handleModalCloseConfirmed();
  }

  public destroy(): void {
    SDKLogger.log("Destroying SDK instance");
    this._modal?.destroy();
    this._modal = null;
    this.reset();
  }

  private handleModalClose(): void {
    SDKLogger.log("Modal close requested");
  }

  private handleModalCloseConfirmed(): void {
    SDKLogger.log("Modal close confirmed");

    const sessionData = this.buildSessionData();

    this._modal?.close();
    this.reset();

    const result: VerificationResult = {
      type: "cancelled",
      session: sessionData
    };

    this.onComplete?.(result);
  }

  private handleIframeLoad(): void {
    SDKLogger.log("Iframe loaded");
  }

  private emitInternalEvent(type: VerificationEvent["type"], data?: VerificationEvent["data"]): void {
    const event: VerificationEvent = {
      type,
      data,
      timestamp: Date.now()
    };

    SDKLogger.log("Emitting internal event:", event);
    this.onEvent?.(event);
  }

  private handleVerificationEvent(event: VerificationEvent): void {
    SDKLogger.log("Verification event:", event);

    this.onEvent?.(event);

    switch (event.type) {
      case "didit:ready":
        SDKLogger.log("Verification iframe ready");
        break;

      case "didit:started":
        SDKLogger.log("User started verification");
        break;

      case "didit:step_started":
        SDKLogger.log("Step started:", event.data?.step);
        break;

      case "didit:step_completed":
        SDKLogger.log("Step completed:", event.data?.step, "-> next:", event.data?.nextStep);
        break;

      case "didit:media_started":
        SDKLogger.log("Media started:", event.data?.mediaType, "for step:", event.data?.step);
        break;

      case "didit:media_captured":
        SDKLogger.log("Media captured for step:", event.data?.step, "isAuto:", event.data?.isAuto);
        break;

      case "didit:document_selected":
        SDKLogger.log("Document selected:", event.data?.documentType, "country:", event.data?.country);
        break;

      case "didit:verification_submitted":
        SDKLogger.log("Verification submitted for step:", event.data?.step);
        break;

      case "didit:code_sent":
        SDKLogger.log("Code sent via:", event.data?.channel, "codeSize:", event.data?.codeSize);
        break;

      case "didit:code_verified":
        SDKLogger.log("Code verified via:", event.data?.channel);
        break;

      case "didit:status_updated":
        SDKLogger.log("Status updated:", event.data?.status, "step:", event.data?.step);
        break;

      case "didit:completed":
        this.handleVerificationCompleted(event);
        break;

      case "didit:cancelled":
        this.handleVerificationCancelled(event);
        break;

      case "didit:error":
        this.handleVerificationError(event);
        break;

      case "didit:step_changed":
        SDKLogger.log("Step changed:", event.data?.step);
        break;

      case "didit:close_request":
        break;
    }
  }

  private handleVerificationCompleted(event: VerificationEvent): void {
    SDKLogger.log("Verification completed:", event.data);

    const sessionData = this.buildSessionData(event.data);

    if (this._configuration?.closeModalOnComplete) {
      this._modal?.close();
      this.reset();
    }

    const result: VerificationResult = {
      type: "completed",
      session: sessionData
    };

    this.onComplete?.(result);
  }

  private handleVerificationCancelled(event: VerificationEvent): void {
    SDKLogger.log("Verification cancelled:", event.data);

    const sessionData = this.buildSessionData(event.data);

    this._modal?.close();
    this.reset();

    const result: VerificationResult = {
      type: "cancelled",
      session: sessionData
    };

    this.onComplete?.(result);
  }

  private handleVerificationError(event: VerificationEvent): void {
    SDKLogger.log("Verification error:", event.data);
  }

  private handleError(error: unknown): void {
    SDKLogger.error("SDK error:", error);

    let verificationError;

    if (error instanceof Error) {
      verificationError = createVerificationError("unknown", error.message);
    } else {
      verificationError = createVerificationError("unknown", "An unknown error occurred");
    }

    this._errorMessage = verificationError.message;
    this.setState("error");

    this._modal?.close();
    this.reset();

    const result: VerificationResult = {
      type: "failed",
      error: verificationError
    };

    this.onComplete?.(result);
  }

  private setState(state: DiditSdkState): void {
    const previousState = this._state;
    this._state = state;

    if (previousState !== state) {
      SDKLogger.log("State changed:", previousState, "->", state);
      this.onStateChange?.(state, this._errorMessage);
    }
  }

  private reset(): void {
    this._state = "idle";
    this._sessionId = undefined;
    this._url = undefined;
    this._errorMessage = undefined;
    this._configuration = undefined;
  }

  private buildSessionData(eventData?: VerificationEvent["data"]): SessionData | undefined {
    const sessionId = eventData?.sessionId || this._sessionId;

    if (!sessionId) {
      return undefined;
    }

    return {
      sessionId,
      status: (eventData?.status || "Pending") as VerificationStatus
    };
  }
}
