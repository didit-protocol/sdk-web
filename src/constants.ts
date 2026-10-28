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
  closeIcon: "didit-close-icon",
  closeIconLegacy: "didit-close-icon-legacy",
  flowSized: "didit-flow-sized",
  loading: "didit-loading",
  confirmOverlay: "didit-confirm-overlay",
  confirmBox: "didit-confirm-box",
  embedded: "didit-embedded"
} as const;

export const SDK_VERSION = "__SDK_PACKAGE_VERSION__";

/**
 * The permissions the verification iframe gets, in a modal and embedded:
 * camera and microphone for capture, clipboard-write for the flow's copy
 * buttons, and digital-credentials-get so the flow can ask a digital ID wallet
 * (Google Wallet) through the W3C Digital Credentials API from inside the iframe.
 */
export const IFRAME_ALLOW =
  "camera; microphone; fullscreen; autoplay; encrypted-media; geolocation; clipboard-write; digital-credentials-get";

/** The verification-URL query parameter each camera option is forwarded as. */
export const CAMERA_QUERY_PARAMS = {
  defaultDocumentCamera: "document_camera",
  defaultLivenessCamera: "liveness_camera",
  showDocumentCameraSwitchButton: "document_camera_switch",
  showLivenessCameraSwitchButton: "liveness_camera_switch"
} as const;

export const CAMERA_LENSES = ["front", "back"] as const;

/**
 * The verification-URL query parameters that tell the hosted flow how the SDK
 * presents it: `sdk_presentation=modal|embedded` and, in a modal,
 * `sdk_close_button=true|false` (whether the SDK draws its close button over
 * the flow's top bar).
 */
export const PRESENTATION_QUERY_PARAMS = {
  presentation: "sdk_presentation",
  closeButton: "sdk_close_button"
} as const;

/**
 * Posted by the hosted flow when it lays itself out for the modal, with
 * `data: { contentHeight, colorScheme?, dir? }`. The modal then grows to the
 * handoff card on a computer and follows the content height in a narrow
 * window. Handled by the modal and never delivered to `onEvent`.
 */
export const LAYOUT_MESSAGE_TYPE = "didit:layout";

/** Languages the hosted flow lays out right to left. */
export const RTL_LANGUAGES = ["ar", "fa", "he"];

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
