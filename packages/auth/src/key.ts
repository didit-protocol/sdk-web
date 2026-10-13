import { decodeText } from "./encoding";
import { DiditAuthError } from "./errors";

export interface PublishableKey {
  mode: "live" | "test";
  /** Runtime API base of the application, without a trailing slash. */
  apiBase: string;
  applicationId: string;
}

const KEY_PATTERN = /^pk_(live|test)_([A-Za-z0-9_-]+)$/;
const APPLICATION_ID = /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/**
 * A publishable key is `pk_live_` or `pk_test_` followed by the base64url
 * encoding of the application's runtime API base, whose last path segment is
 * the application id, for example
 * `https://auth.didit.me/auth/v2/authentication/<application id>`.
 * Live keys must use HTTPS; test keys may also point at a loopback HTTP host.
 */
export function parsePublishableKey(key: string): PublishableKey {
  const match = KEY_PATTERN.exec(typeof key === "string" ? key.trim() : "");
  let url: URL | null = null;

  try {
    if (match) url = new URL(decodeText(match[2]));
  } catch {
    url = null;
  }
  const secure =
    url?.protocol === "https:" ||
    (match?.[1] === "test" && url?.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname));

  if (!match || !url || !secure || url.username || url.password || url.search || url.hash) {
    throw new DiditAuthError("invalid_publishable_key", "The publishable key is not a valid Didit key.");
  }
  const apiBase = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  const applicationId = APPLICATION_ID.exec(apiBase)?.[1];

  if (!applicationId) {
    throw new DiditAuthError("invalid_publishable_key", "The publishable key has no application id.");
  }
  return { mode: match[1] as PublishableKey["mode"], apiBase, applicationId };
}
