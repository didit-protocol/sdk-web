export const DEFAULT_CONFIG = {
  zIndex: 9999,
  showCloseButton: true,
  showExitConfirmation: true,
  loggingEnabled: false,
  closeModalOnComplete: false
} as const;

export const CSS_CLASSES = {
  overlay: "didit-modal-overlay",
  container: "didit-modal-container",
  content: "didit-modal-content",
  iframe: "didit-verification-iframe",
  closeButton: "didit-close-button",
  loading: "didit-loading",
  confirmOverlay: "didit-confirm-overlay",
  confirmBox: "didit-confirm-box",
  embedded: "didit-embedded"
} as const;

export const SDK_VERSION = "0.1.6";
