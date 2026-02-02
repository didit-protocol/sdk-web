class SDKLogger {
  private static _enabled = false;

  static get isEnabled(): boolean {
    return this._enabled;
  }

  static set isEnabled(value: boolean) {
    this._enabled = value;
  }

  static log(...args: unknown[]): void {
    if (this._enabled) {
      console.log("[DiditSDK]", ...args);
    }
  }

  static warn(...args: unknown[]): void {
    if (this._enabled) {
      console.warn("[DiditSDK]", ...args);
    }
  }

  static error(...args: unknown[]): void {
    if (this._enabled) {
      console.error("[DiditSDK]", ...args);
    }
  }
}

export { SDKLogger };

export function generateModalId(): string {
  return `didit-modal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.hostname.endsWith('.didit.me');
  } catch {
    return false;
  }
}

export function createVerificationError(
  type: "sessionExpired" | "networkError" | "cameraAccessDenied" | "unknown",
  customMessage?: string
): { type: typeof type; message: string } {
  const messages = {
    sessionExpired: "Your verification session has expired.",
    networkError: "A network error occurred. Please try again.",
    cameraAccessDenied: "Camera access is required for verification.",
    unknown: customMessage || "An unknown error occurred."
  };

  return {
    type,
    message: customMessage || messages[type]
  };
}
