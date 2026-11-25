type WebViewKind =
  | "browser"
  | "whatsapp"
  | "gsa"
  | "instagram"
  | "facebook"
  | "messenger"
  | "tiktok"
  | "line"
  | "wechat"
  | "telegram"
  | "twitter"
  | "linkedin"
  | "snapchat"
  | "generic-wv";

interface WebViewSignals {
  kind: WebViewKind;
  hostAppVersion: string | null;
  isStandaloneBrowser: boolean;
}

/**
 * The apps whose in-app browser names itself in the user agent, in the order they are looked for:
 * the kind, the marker that tells it, and where its version is when the marker does not capture it.
 * The Google app comes early because on iOS its WKWebView exposes no navigator.mediaDevices at
 * all, so no capture is ever possible there. The last entry is a web view that names no app.
 */
const HOST_APPS: [kind: WebViewKind, marker: RegExp, version?: RegExp][] = [
  ["whatsapp", /WA(?:4[A]|4iOS)\/([\d.]+)/],
  ["gsa", /GSA\/([\d.]+)/],
  ["instagram", /Instagram\s+([\d.]+)/],
  ["facebook", /FBAN|FBAV/, /FBAV\/([\d.]+)/],
  ["messenger", /MessengerLiteForiOS|MessengerForiOS|FB_IAB\/Messenger/],
  ["tiktok", /(?:musical_ly|TikTok|trill)_(\d+)/i],
  ["line", /Line\/([\d.]+)/],
  ["wechat", /MicroMessenger/, /MicroMessenger\/([\d.]+)/],
  ["telegram", /Telegram/i],
  ["twitter", /Twitter/i],
  ["linkedin", /LinkedInApp/i],
  ["snapchat", /Snapchat/i],
  ["generic-wv", /\bwv\)|\bWebView\b/i],
];

/**
 * The classification by host-app markers, as version 4 of the composite hash always made it. It
 * knows nothing about a bare iOS web view: that one comes out as "browser" here.
 */
function classifyByHostMarkers(userAgent: string): WebViewSignals {
  for (const [kind, marker, version = marker] of HOST_APPS) {
    if (marker.test(userAgent)) {
      return { kind, hostAppVersion: userAgent.match(version)?.[1] ?? null, isStandaloneBrowser: false };
    }
  }
  return { kind: "browser", hostAppVersion: null, isStandaloneBrowser: true };
}

/**
 * The kind of browser or in-app web view the page runs in. The collector classifies the same way,
 * so a page reports one kind before and after the collector has loaded (the two are compared in
 * e2e/webview-kind.spec.mjs).
 *
 * An iOS web view that names no host app is recognised by what it lacks: every standalone iOS
 * browser ends its user agent with a `Safari/` token, a bare WKWebView does not.
 */
function detectWebViewContext(userAgent: string): WebViewSignals {
  const byMarkers = classifyByHostMarkers(userAgent);
  return byMarkers.isStandaloneBrowser &&
    /iPhone|iPad|iPod/.test(userAgent) &&
    userAgent.includes("AppleWebKit") &&
    !userAgent.includes("Safari/")
    ? { kind: "generic-wv", hostAppVersion: null, isStandaloneBrowser: false }
    : byMarkers;
}

/**
 * The web view kind that enters the composite hash. It is the classification version 4 of the hash
 * always used, in which a bare iOS web view is "browser": reporting it as a web view (above) must
 * not move the hash of any device already known. Do not "fix" this to the reported kind: that
 * would change every such device's hash once. Raise COMPOSITE_HASH_VERSION on purpose instead.
 */
function webViewKindForVersion4Hash(userAgent: string): WebViewKind {
  return classifyByHostMarkers(userAgent).kind;
}

export { detectWebViewContext, type WebViewKind, type WebViewSignals, webViewKindForVersion4Hash };
