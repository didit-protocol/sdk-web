import { describe, expect, it } from "@jest/globals";

import { DiditAuthError } from "../errors";
import { parsePublishableKey } from "../key";
import { KEYS, publishableKeyFor } from "./helpers/replay";

function rejects(key: string): void {
  expect(() => parsePublishableKey(key)).toThrow(DiditAuthError);
  try {
    parsePublishableKey(key);
  } catch (error) {
    expect((error as DiditAuthError).code).toBe("invalid_publishable_key");
  }
}

describe("parsePublishableKey", () => {
  it("reads the application's origin from the keys the Didit auth service issues", () => {
    // Live and Sandbox applications on Didit's hosts, an active custom domain, and a local Sandbox application.
    expect(parsePublishableKey(KEYS.live.publishableKey)).toEqual({ mode: "live", origin: KEYS.live.origin });
    expect(parsePublishableKey(KEYS.sandbox.publishableKey)).toEqual({ mode: "test", origin: KEYS.sandbox.origin });
    expect(parsePublishableKey(KEYS.customDomain.publishableKey)).toEqual({ mode: "live", origin: "https://auth.example.com" });
    expect(parsePublishableKey(KEYS.localSandbox.publishableKey)).toEqual({
      mode: "test",
      origin: KEYS.localSandbox.origin
    });
  });

  it("ignores surrounding whitespace", () => {
    expect(parsePublishableKey(` ${KEYS.live.publishableKey}\n`).origin).toBe(KEYS.live.origin);
  });

  it("lets only test keys name a local HTTP host", () => {
    // The service issues no key to a live application served over HTTP.
    expect(KEYS.localLive.publishableKey).toBeNull();
    for (const local of ["http://localhost:8765", "http://127.0.0.1:8765", "http://[::1]:8765", KEYS.localLive.origin]) {
      expect(parsePublishableKey(publishableKeyFor(local)).origin).toBe(local);
      rejects(publishableKeyFor(local, "live"));
    }
    rejects(publishableKeyFor("http://auth.example.com"));
    rejects(publishableKeyFor("http://localhost.example.com"));
  });

  it("rejects keys that are not Didit publishable keys", () => {
    const encoded = KEYS.live.publishableKey.slice("pk_live_".length);

    rejects("");
    rejects("sk_live_abc");
    rejects(`pk_prod_${encoded}`);
    rejects(`pk_live_${Buffer.from(KEYS.live.origin).toString("base64")}=`);
    rejects(`${KEYS.live.publishableKey}=`);
    rejects("pk_live_bm90IGEgdXJs");
    rejects(undefined as unknown as string);
  });

  it("rejects anything but an origin: an API path, credentials, query, fragment or a non-canonical host", () => {
    const { origin, applicationId } = KEYS.live;

    rejects(publishableKeyFor(`${origin}/`, "live"));
    rejects(publishableKeyFor(`${origin}/auth/v2/authentication/${applicationId}`, "live"));
    rejects(publishableKeyFor(origin.replace("https://", "https://user:secret@"), "live"));
    rejects(publishableKeyFor(`${origin}?next=1`, "live"));
    rejects(publishableKeyFor(`${origin}#top`, "live"));
    rejects(publishableKeyFor(origin.toUpperCase().replace("HTTPS://", "https://"), "live"));
    rejects(publishableKeyFor("https://auth.example.com:443", "live"));
    rejects(publishableKeyFor("https://auth.example.com:0", "live"));
  });
});
