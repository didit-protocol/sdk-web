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

export const SDK_VERSION = "__SDK_PACKAGE_VERSION__";

/** The verification-URL query parameter each camera option is forwarded as. */
export const CAMERA_QUERY_PARAMS = {
  defaultDocumentCamera: "document_camera",
  defaultLivenessCamera: "liveness_camera",
  showDocumentCameraSwitchButton: "document_camera_switch",
  showLivenessCameraSwitchButton: "liveness_camera_switch"
} as const;

export const CAMERA_LENSES = ["front", "back"] as const;

export const languages  = [
    "ar",
    "bg",
    "bn",
    "ca",
    "cnr",
    "cs",
    "da",
    "de",
    "el",
    "en",
    "es",
    "et",
    "fa",
    "fi",
    "fr",
    "he",
    "hi",
    "hr",
    "hu",
    "hy",
    "id",
    "it",
    "ja",
    "ka",
    "ko",
    "lt",
    "lv",
    "mk",
    "mn",
    "ms",
    "nl",
    "no",
    "pl",
    "pt-BR",
    "pt",
    "ro",
    "ru",
    "sk",
    "sl",
    "so",
    "sr",
    "sv",
    "th",
    "tr",
    "uk",
    "uz",
    "vi",
    "zh-CN",
    "zh-TW",
    "zh",
]
