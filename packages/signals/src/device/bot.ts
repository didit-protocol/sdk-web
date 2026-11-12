import { type AudioSignals } from "./signals/audio";
import { type CanvasSignals } from "./signals/canvas";
import { type FontSignals } from "./signals/fonts";
import { type NavigatorSignals } from "./signals/navigator";
import { type WebGLSignals } from "./signals/webgl";

interface BotDetection {
  /** 0 to 1: the strongest flag found. Didit treats 0.8 and above as automation. */
  score: number;
  flags: string[];
}

/**
 * What the navigator alone says about automation.
 *
 * The score is the strongest flag found, not a count: one conclusive signal is not diluted because
 * the other checks came back clean. Only what a browser never shows to a person (a driver's
 * `navigator.webdriver`, a headless or automation user agent) weighs 0.8 or more.
 */
function detectBotFromNavigator(signals: NavigatorSignals): BotDetection {
  const flags: string[] = [];
  const userAgent = signals.userAgent;
  let score = 0;

  if (typeof navigator !== "undefined" && (navigator as Navigator & { webdriver?: boolean }).webdriver) {
    flags.push("webdriver");
    score = 0.9;
  }
  if (/HeadlessChrome|PhantomJS|Selenium|puppeteer|playwright/i.test(userAgent)) {
    flags.push("headless-ua");
    score = 0.9;
  }
  if (signals.uaDataMobile === false && /Android|iPhone|iPad/i.test(userAgent)) {
    flags.push("ua-mobile-mismatch");
    score = score || 0.3;
  }

  return { score, flags };
}

interface RenderingSignals {
  navigator: NavigatorSignals;
  webgl: WebGLSignals;
  canvas: CanvasSignals;
  audio: AudioSignals;
  fonts: FontSignals;
}

/**
 * The navigator flags plus what the rendering probes add. None of the added flags is conclusive on
 * its own (a person's browser can fall back to a software renderer, a privacy browser blocks the
 * probes), so each weighs well under the 0.8 that counts as automation.
 */
function detectBot(signals: RenderingSignals): BotDetection {
  const { score: navigatorScore, flags } = detectBotFromNavigator(signals.navigator);
  let score = navigatorScore;
  const userAgent = signals.navigator.userAgent;

  const renderer = (signals.webgl.unmaskedRenderer || signals.webgl.renderer || "").toLowerCase();
  if (/swiftshader|software/i.test(renderer)) {
    flags.push("software-renderer");
    score = Math.max(score, 0.5);
  }

  if (signals.webgl.blocked && signals.canvas.blocked && signals.audio.blocked && signals.fonts.blocked) {
    flags.push("all-active-probes-blocked");
    score = Math.max(score, 0.3);
  }

  // navigator.plugins is empty on most mobile browsers: only a desktop without plugins counts.
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.plugins !== "undefined" &&
    navigator.plugins.length === 0 &&
    !/Mobi|Android|iPhone|iPad/i.test(userAgent)
  ) {
    flags.push("desktop-no-plugins");
    score = Math.max(score, 0.3);
  }

  return { score, flags };
}

export { type BotDetection, detectBot, detectBotFromNavigator };
