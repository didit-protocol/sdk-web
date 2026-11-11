import { type BotDetection } from "./bot";
import { type AudioSignals } from "./signals/audio";
import { type CanvasSignals } from "./signals/canvas";
import { type CodecSignals } from "./signals/codecs";
import { type EnvironmentSignals } from "./signals/environment";
import { type FontSignals } from "./signals/fonts";
import { type HardwareSignals } from "./signals/hardware";
import { type MathSignals } from "./signals/math";
import { type NavigatorSignals } from "./signals/navigator";
import { type WebGLSignals } from "./signals/webgl";
import { type WebViewSignals } from "./signals/webview";
import { type COMPOSITE_HASH_VERSION } from "./canonical";

/**
 * The signals every Didit web client sends, whichever entry collected them.
 *
 * `tier` says how much was collected: `lite` is the navigator and the webview kind (what the
 * 5 KB `@didit-protocol/signals` entry reads), `full` adds the families of `FullDeviceSignals`
 * (`@didit-protocol/signals/device`). The composite hash of the two tiers differs for the same
 * device, because the full one covers more of it.
 */
interface DeviceSignals {
  platform: "web";
  tier: "lite" | "full";
  compositeHashVersion: typeof COMPOSITE_HASH_VERSION;
  navigator: NavigatorSignals;
  webview: WebViewSignals;
}

interface FullDeviceSignals extends DeviceSignals {
  tier: "full";
  canvas: CanvasSignals;
  webgl: WebGLSignals;
  audio: AudioSignals;
  fonts: FontSignals;
  math: MathSignals;
  apiBitmap: string;
  apiMissing: string[];
  hardware: HardwareSignals;
  environment: EnvironmentSignals;
  // Sent for analysis and kept out of the composite hash: the codec answers are not steady enough
  // on one browser to be part of what identifies it.
  codecs: CodecSignals;
}

/** The didit-fp-v2 device fingerprint payload, sent as the `fingerprint_v2` body field. */
interface DeviceFingerprintPayload<S extends DeviceSignals = DeviceSignals> {
  version: 2;
  schema: "didit-fp-v2";
  platform: "web";
  collectedAt: string;
  /** The id this browser profile is known by, kept in the browser's storage. */
  persistentId: string;
  persistentIdSources: string[];
  persistentIdWasCreated: boolean;
  signals: S;
  bot: BotDetection;
  /** A hash of the signals that describe the device. Shared by devices of one kind: it is not an id. */
  compositeHash: string;
  /** The `didit-fp-*` hash of clients before didit-fp-v2. Full tier only. */
  legacyCompatibilityHash?: string;
}

type FullDeviceFingerprintPayload = DeviceFingerprintPayload<FullDeviceSignals>;

export { type DeviceFingerprintPayload, type DeviceSignals, type FullDeviceFingerprintPayload, type FullDeviceSignals };
