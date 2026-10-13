import { decodeText } from "./encoding";
import { DiditAuthError } from "./errors";

export interface PublishableKey {
  mode: "live" | "test";
  /** The application's origin: its hosted pages, runtime API and token issuer. */
  origin: string;
}

const KEY_PATTERN = /^pk_(live|test)_([A-Za-z0-9_-]+)$/;
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/** A host on this machine: a loopback address, `localhost` or a name under it (RFC 6761). */
export function isLoopback(hostname: string): boolean {
  return LOOPBACK_HOSTS.includes(hostname) || hostname.endsWith(".localhost");
}

/**
 * A publishable key is `pk_live_` or `pk_test_` followed by the base64url
 * encoding, without padding, of the application's origin: its own host such as
 * `https://<application>.auth.didit.me`, or its custom domain once active.
 * Live keys must use HTTPS; test keys may also name a local HTTP host.
 */
export function parsePublishableKey(key: string): PublishableKey {
  const match = KEY_PATTERN.exec(typeof key === "string" ? key.trim() : "");
  let text = "";
  let url: URL | null = null;

  try {
    if (match) url = new URL((text = decodeText(match[2])));
  } catch {
    url = null;
  }
  const secure =
    url?.protocol === "https:" || (match?.[1] === "test" && url?.protocol === "http:" && isLoopback(url.hostname));

  // Exactly an origin, as Didit writes it: no path, query, fragment, credentials or trailing slash.
  if (!match || !url || !secure || text !== url.origin || url.port === "0") {
    throw new DiditAuthError("invalid_publishable_key", "The publishable key is not a valid Didit key.");
  }
  return { mode: match[1] as PublishableKey["mode"], origin: url.origin, apiBase: url.origin, applicationId: url.origin } as PublishableKey & { apiBase: string; applicationId: string };
}
