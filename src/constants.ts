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
  sizeAnimated: "didit-size-animated",
  loading: "didit-loading",
  confirmOverlay: "didit-confirm-overlay",
  confirmBox: "didit-confirm-box",
  embedded: "didit-embedded",
  curtain: "didit-modal-curtain"
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
 * The verification-URL query parameter that carries the device id this page
 * already keeps for Didit, when it keeps one. A browser gives the flow in the
 * frame storage of its own, apart from this page's, so without it a
 * verification and this site's events never share a device id.
 */
export const DEVICE_ID_QUERY_PARAM = "sdk_device_id";

/**
 * Posted by the hosted flow when it lays itself out for the modal, with
 * `data: { contentHeight, colorScheme?, dir?, kind? }` (`kind` is `handoff` or `step`, `step` when missing). The modal then grows to the
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

/** The origin that serves Bank Link, by default. An integrator can point the SDK at another one (see `BankLinkOptions.baseUrl`). */
export const BANK_LINK_DEFAULT_ORIGIN = "https://verify.didit.me";

/** Every Bank Link wire message has a `type` that starts with this prefix and `v: BANK_LINK_PROTOCOL_VERSION`. */
export const BANK_LINK_MESSAGE_PREFIX = "didit:bank_link:";
export const BANK_LINK_PROTOCOL_VERSION = 1;

/** What the Bank Link frame may use: the link's copy buttons. It never gets the camera, microphone or location. */
export const BANK_LINK_IFRAME_ALLOW = "clipboard-write";

/**
 * Where the SDK keeps, in the page's own sessionStorage (first party to the integrator, so a
 * frame's partitioned storage does not matter), the instance id and the record that lets
 * `resumeBankLink` pick the flow up after a full-page redirect. Neither holds a token.
 */
export const BANK_LINK_INSTANCE_STORAGE_KEY = "didit_bank_link_instance";
export const BANK_LINK_RESUME_STORAGE_KEY = "didit_bank_link_resume";
export const BANK_LINK_RESUME_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The query parameter the hosted page adds to the integrator's return URL: a single-use resume code. */
export const BANK_LINK_RESUME_QUERY_PARAM = "didit_resume";

/** The window name of the bank popup, so a second request reuses the same window. */
export const BANK_LINK_POPUP_NAME = "didit_bank";
