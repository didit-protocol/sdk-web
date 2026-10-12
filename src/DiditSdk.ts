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
  StartVerificationOptions,
  SubmitTransactionOptions,
  SubmitTransactionResult,
  TransactionActionCompletedCallback,
  TransactionActionCompletedError
} from "./types";

import { VerificationModal } from "./modal";
import { DEFAULT_CONFIG } from "./constants";
import { SDKLogger, buildVerificationUrl, createVerificationError } from "./utils";
import {
  DEFAULT_TRANSACTION_BASE_URL,
  DiditTransactionError,
  pollTransactionAfterAction,
  submitTransactionRequest
} from "./transactions";

type TransactionActionOutcome = "finished" | "aborted";

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
  private _actionModal: VerificationModal | null = null;
  private _actionModalSettle: ((outcome: TransactionActionOutcome) => void) | null = null;
  /**
   * Bumped by destroy() to invalidate any transaction action in flight
   * (pending action modal and/or its follow-up poll) so a torn-down SDK
   * instance can never deliver a late onActionCompleted. A new
   * submitTransaction call always reads the current generation, so it is
   * unaffected by a destroy() that happened before it started.
   */
  private _actionGeneration = 0;

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

  /**
   * True while a transaction's wallet-ownership action modal (auto-launched
   * by submitTransaction) is on screen. verification_session actions are
   * never auto-launched, so they never affect this flag - see
   * {@link submitTransaction}. Tracked separately from {@link isPresented},
   * which reflects the verification modal only.
   */
  public get isActionModalPresented(): boolean {
    return this._actionModal?.isOpen() ?? false;
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

      this._url = buildVerificationUrl(url, config);
      this.setState("loading");

      this.emitInternalEvent("didit:started", {});

      this._modal?.open(this._url);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Submits a transaction (including travel-rule and crypto-monitoring payloads)
   * directly from the end-user device.
   *
   * The request is authenticated with a short-lived transaction token minted by
   * your backend (POST /v3/transactions/sdk-token/) and sent via the
   * X-Transaction-Token header. Device intelligence is attached automatically:
   * the SDK collects a didit-fp-v2 fingerprint and sends it as the X-Didit-PID /
   * X-Didit-FP-Hash headers plus a `fingerprint_v2` body field.
   *
   * When the response contains an `actionRequired` block, the contract differs
   * by type:
   * - `wallet_ownership` (a same-origin, Didit-hosted widget): when
   *   `autoLaunchAction` is not false, the SDK opens the action URL in the
   *   verification modal itself. Once the flow completes or the modal is
   *   closed, the transaction is re-fetched with a bounded poll (never a
   *   single event) and `onActionCompleted` is invoked with the refreshed
   *   result.
   * - `verification_session` (a biometric verification session): never
   *   auto-launched, regardless of `autoLaunchAction`. It is only ever
   *   returned in `result.actionRequired` for the host application to launch
   *   with its own verification integration (e.g. `startVerification`).
   *
   * @param options Submission options: transactionToken, transaction payload,
   * optional baseUrl (defaults to https://verification.didit.me),
   * autoLaunchAction (defaults to true, applies to wallet_ownership actions
   * only) and onActionCompleted callback.
   * @returns The created transaction: transactionId, status, travelRuleStatus
   * and actionRequired when a user action is pending.
   * @throws {DiditTransactionError} Typed as "invalid_token", "expired_token",
   * "validation" (with fieldErrors) or "network".
   */
  public async submitTransaction(options: SubmitTransactionOptions): Promise<SubmitTransactionResult> {
    if (!options?.transactionToken || typeof options.transactionToken !== "string") {
      throw new DiditTransactionError("invalid_token", "transactionToken is required.");
    }
    if (!options.transaction || typeof options.transaction !== "object") {
      throw new DiditTransactionError("validation", "transaction payload is required.");
    }
    if (!options.transaction.txnId || typeof options.transaction.txnId !== "string") {
      throw new DiditTransactionError("validation", "transaction.txnId is required.");
    }
    if (!options.transaction.details || typeof options.transaction.details !== "object") {
      throw new DiditTransactionError("validation", "transaction.details is required.");
    }

    const baseUrl = (options.baseUrl ?? DEFAULT_TRANSACTION_BASE_URL).replace(/\/+$/, "");
    SDKLogger.log("Submitting transaction:", options.transaction.txnId);

    const result = await submitTransactionRequest({
      baseUrl,
      transactionToken: options.transactionToken,
      transaction: options.transaction
    });

    SDKLogger.log("Transaction submitted:", result);

    // Only wallet_ownership is a same-origin, Didit-hosted widget that is
    // safe for the SDK to open on the integrator's behalf. verification_session
    // is never auto-launched: it is already returned in result.actionRequired
    // above for the host to launch with its own verification integration.
    const autoLaunchAction = options.autoLaunchAction ?? true;
    if (autoLaunchAction && result.actionRequired?.type === "wallet_ownership" && result.actionRequired.url) {
      void this.runTransactionAction(baseUrl, options.transactionToken, result, options.onActionCompleted);
    }

    return result;
  }

  /**
   * Dismisses everything currently on screen in one deterministic call: a
   * pending transaction action modal is treated as an abort (no follow-up
   * poll, no onActionCompleted) and the verification modal is always closed
   * afterwards, regardless of whether an action modal was present.
   */
  public close(): void {
    SDKLogger.log("Closing verification programmatically");
    this._actionModalSettle?.("aborted");
    this.handleModalCloseConfirmed();
  }

  public destroy(): void {
    SDKLogger.log("Destroying SDK instance");
    // Invalidate any transaction action in flight so a poll that is already
    // running cannot deliver onActionCompleted after teardown.
    this._actionGeneration++;
    this._actionModalSettle?.("aborted");
    this._modal?.destroy();
    this._modal = null;
    this.reset();
  }

  private async runTransactionAction(
    baseUrl: string,
    transactionToken: string,
    submitResult: SubmitTransactionResult,
    onActionCompleted: TransactionActionCompletedCallback | undefined
  ): Promise<void> {
    const generation = this._actionGeneration;
    let delivered = false;

    // Guarantees at-most-once delivery: a throwing integrator callback must
    // not be re-invoked by a surrounding catch, and a destroy() that
    // happened while we were awaiting the modal/poll must suppress delivery
    // entirely rather than calling back into a torn-down integration.
    const deliver = (result: SubmitTransactionResult, error?: TransactionActionCompletedError): void => {
      if (delivered || generation !== this._actionGeneration) return;
      delivered = true;
      try {
        onActionCompleted?.(result, error);
      } catch (callbackError) {
        SDKLogger.error("onActionCompleted callback threw:", callbackError);
      }
    };

    try {
      const outcome = await this.presentTransactionActionModal(submitResult.actionRequired!.url);
      if (outcome === "aborted" || generation !== this._actionGeneration) {
        return;
      }
      if (!submitResult.transactionId) {
        deliver(submitResult);
        return;
      }

      let refreshed: SubmitTransactionResult | null = null;
      let pollError: DiditTransactionError | undefined;
      try {
        refreshed = await pollTransactionAfterAction({
          baseUrl,
          transactionToken,
          transactionId: submitResult.transactionId,
          initialStatus: submitResult.status,
          isAborted: () => generation !== this._actionGeneration
        });
      } catch (error) {
        if (error instanceof DiditTransactionError) {
          pollError = error;
        } else {
          throw error;
        }
      }

      if (pollError) {
        // Terminal auth failure (invalid_token/expired_token): surface it
        // instead of silently handing back the stale pre-action result.
        deliver(submitResult, { type: pollError.type, message: pollError.message });
        return;
      }
      deliver(refreshed ?? submitResult);
    } catch (error) {
      SDKLogger.error("Transaction action follow-up failed:", error);
      deliver(submitResult);
    }
  }

  private presentTransactionActionModal(url: string): Promise<TransactionActionOutcome> {
    // Abort any previous action modal before opening a new one.
    this._actionModalSettle?.("aborted");

    return new Promise<TransactionActionOutcome>((resolve) => {
      let settled = false;
      const settle = (outcome: TransactionActionOutcome): void => {
        if (settled) return;
        settled = true;
        const modal = this._actionModal;
        this._actionModal = null;
        this._actionModalSettle = null;
        modal?.destroy();
        resolve(outcome);
      };

      // this._actionModalSettle is assigned only after the modal is
      // successfully constructed and opened. If either throws (e.g. no
      // `document` in Node/SSR, or document.body not ready yet), the
      // settle callback must not be left dangling: a later close() would
      // otherwise find a stale this._actionModalSettle for a modal that
      // was never presented, "settle" it, and return early without ever
      // closing the actual verification modal.
      let modal: VerificationModal;
      try {
        modal = new VerificationModal(undefined, {
          onClose: () => {},
          onCloseConfirmed: () => settle("finished"),
          onMessage: (event) => {
            this.onEvent?.(event);
            if (event.type === "didit:completed" || event.type === "didit:cancelled") {
              settle("finished");
            }
          },
          onIframeLoad: () => {}
        });

        SDKLogger.log("Launching required transaction action:", url);
        modal.open(url);
      } catch (error) {
        this._actionModal = null;
        this._actionModalSettle = null;
        throw error;
      }

      this._actionModal = modal;
      this._actionModalSettle = settle;
    });
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
