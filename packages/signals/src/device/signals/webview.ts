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

function detectWebViewContext(userAgent: string): WebViewSignals {
  if (!userAgent) {
    return { kind: "browser", hostAppVersion: null, isStandaloneBrowser: true };
  }
  const ua = userAgent;

  const waMatch = ua.match(/WA(?:4[A]|4iOS)\/([\d.]+)/);
  if (waMatch) return { kind: "whatsapp", hostAppVersion: waMatch[1], isStandaloneBrowser: false };

  // Google app (iOS/Android) in-app browser. On iOS its WKWebView exposes no
  // navigator.mediaDevices at all, so no capture is ever possible there.
  const gsaMatch = ua.match(/GSA\/([\d.]+)/);
  if (gsaMatch) return { kind: "gsa", hostAppVersion: gsaMatch[1], isStandaloneBrowser: false };

  const igMatch = ua.match(/Instagram\s+([\d.]+)/);
  if (igMatch) return { kind: "instagram", hostAppVersion: igMatch[1], isStandaloneBrowser: false };

  if (/FBAN|FBAV/.test(ua)) {
    const fbVer = ua.match(/FBAV\/([\d.]+)/);
    return { kind: "facebook", hostAppVersion: fbVer?.[1] ?? null, isStandaloneBrowser: false };
  }

  if (/MessengerLiteForiOS|MessengerForiOS|FB_IAB\/Messenger/.test(ua)) {
    return { kind: "messenger", hostAppVersion: null, isStandaloneBrowser: false };
  }

  const ttMatch = ua.match(/(?:musical_ly|TikTok|trill)_(\d+)/i);
  if (ttMatch) return { kind: "tiktok", hostAppVersion: ttMatch[1], isStandaloneBrowser: false };

  const lineMatch = ua.match(/Line\/([\d.]+)/);
  if (lineMatch) return { kind: "line", hostAppVersion: lineMatch[1], isStandaloneBrowser: false };

  if (/MicroMessenger/.test(ua)) {
    const wcVer = ua.match(/MicroMessenger\/([\d.]+)/);
    return { kind: "wechat", hostAppVersion: wcVer?.[1] ?? null, isStandaloneBrowser: false };
  }

  if (/Telegram/i.test(ua)) {
    return { kind: "telegram", hostAppVersion: null, isStandaloneBrowser: false };
  }

  if (/Twitter|TwitterAndroid/i.test(ua)) {
    return { kind: "twitter", hostAppVersion: null, isStandaloneBrowser: false };
  }

  if (/LinkedInApp/i.test(ua)) {
    return { kind: "linkedin", hostAppVersion: null, isStandaloneBrowser: false };
  }

  if (/Snapchat/i.test(ua)) {
    return { kind: "snapchat", hostAppVersion: null, isStandaloneBrowser: false };
  }

  if (/\bwv\)|\bWebView\b/i.test(ua)) {
    return { kind: "generic-wv", hostAppVersion: null, isStandaloneBrowser: false };
  }

  return { kind: "browser", hostAppVersion: null, isStandaloneBrowser: true };
}

export { detectWebViewContext, type WebViewKind, type WebViewSignals };
