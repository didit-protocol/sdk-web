export type DiditSdkState = "idle" | "loading" | "ready" | "error";

export type VerificationStatus = "Approved" | "Pending" | "Declined";

export interface SessionData {
  sessionId: string;
  status: VerificationStatus;
  country?: string;
  documentType?: string;
}

export type VerificationErrorType = "sessionExpired" | "networkError" | "cameraAccessDenied" | "unknown";

export interface VerificationError {
  type: VerificationErrorType;
  message: string;
}

export type VerificationResultType = "completed" | "cancelled" | "failed";

export interface VerificationResult {
  type: VerificationResultType;
  session?: SessionData;
  error?: VerificationError;
}

export interface DiditSdkConfiguration {
  loggingEnabled?: boolean;
  containerElement?: HTMLElement;
  zIndex?: number;
  showCloseButton?: boolean;
  showExitConfirmation?: boolean;
  callbackUrl?: string;
}

export interface StartVerificationOptions {
  url: string;
  configuration?: DiditSdkConfiguration;
}

export type VerificationEventType =
  | "didit:ready"
  | "didit:started"
  | "didit:step_started"
  | "didit:step_completed"
  | "didit:media_started"
  | "didit:media_captured"
  | "didit:document_selected"
  | "didit:verification_submitted"
  | "didit:code_sent"
  | "didit:code_verified"
  | "didit:status_updated"
  | "didit:completed"
  | "didit:cancelled"
  | "didit:error"
  | "didit:step_changed"
  | "didit:close_request";

export interface VerificationEventData {
  sessionId?: string;
  status?: string;
  step?: string;
  nextStep?: string;
  previousStep?: string;
  error?: string;
  country?: string;
  documentType?: string;
  isAuto?: boolean;
  mediaType?: string;
  channel?: string;
  codeSize?: number;
  [key: string]: unknown;
}

export interface VerificationEvent {
  type: VerificationEventType;
  data?: VerificationEventData;
  timestamp?: number;
}

export type VerificationCallback = (result: VerificationResult) => void;

export type StateChangeCallback = (state: DiditSdkState, error?: string) => void;

export type EventCallback = (event: VerificationEvent) => void;
