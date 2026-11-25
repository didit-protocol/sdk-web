import { type NavigatorSignals } from "./signals/navigator";
import { type WebViewSignals } from "./signals/webview";
import { type COMPOSITE_HASH_VERSION } from "./canonical";

/**
 * The signals every Didit web client sends.
 *
 * `tier` says how much was collected: `lite` is the navigator and the webview kind (what this
 * package builds itself), `full` is what the separately loaded collector reports, which adds more
 * families of signals than this package names. The composite hash of the two tiers differs for the
 * same device, because the full one covers more of it.
 */
interface DeviceSignals {
  platform: "web";
  tier: "lite" | "full";
  compositeHashVersion: typeof COMPOSITE_HASH_VERSION;
  navigator: NavigatorSignals;
  webview: WebViewSignals;
  /**
   * The page that embeds this one, when it passed its own stored id (`@didit-protocol/sdk-web`
   * passes it to the verification it opens). It links what happens in the frame with the events
   * of the site around it. Not part of the composite hash.
   */
  embedder?: { persistentId: string };
  /** The further families of the full tier. Their shape is the collector's and may grow. */
  [family: string]: unknown;
}

/** The didit-fp-v2 device fingerprint payload, sent as the `fingerprint_v2` body field. */
interface DeviceFingerprintPayload {
  version: 2;
  schema: "didit-fp-v2";
  platform: "web";
  collectedAt: string;
  /** The id this browser profile is known by, kept in the browser's storage. */
  persistentId: string;
  persistentIdSources: string[];
  persistentIdWasCreated: boolean;
  signals: DeviceSignals;
  /** A hash of the signals that describe the device. Shared by devices of one kind: it is not an id. */
  compositeHash: string;
  /** The `didit-fp-*` hash of clients before didit-fp-v2. Full tier only. */
  legacyCompatibilityHash?: string;
  /**
   * Facts about how the page was driven, as compact JSON text. Full tier only. Didit's servers
   * read it and decide the automation score; nothing here is scored in the browser.
   */
  evidence?: string;
}

export { type DeviceFingerprintPayload, type DeviceSignals };
