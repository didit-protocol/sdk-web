import { describe, expect, it } from "@jest/globals";

import { DiditAuthError } from "../errors";
import { parsePublishableKey } from "../key";
import { publishableKeyFor } from "./helpers/replay";

const APPLICATION_ID = "b83c95f9-93bd-4bed-a94f-f4b354a446db";
const LIVE_BASE = `https://auth.didit.me/auth/v2/authentication/${APPLICATION_ID}`;

function rejects(key: string): void {
  expect(() => parsePublishableKey(key)).toThrow(DiditAuthError);
  try {
    parsePublishableKey(key);
  } catch (error) {
    expect((error as DiditAuthError).code).toBe("invalid_publishable_key");
  }
}

describe("parsePublishableKey", () => {
  it("decodes the runtime API base and application id of a live key", () => {
    expect(parsePublishableKey(publishableKeyFor(LIVE_BASE, "live"))).toEqual({
      mode: "live",
      apiBase: LIVE_BASE,
      applicationId: APPLICATION_ID
    });
  });

  it("drops a trailing slash and surrounding whitespace", () => {
    expect(parsePublishableKey(` ${publishableKeyFor(`${LIVE_BASE}/`, "live")} `).apiBase).toBe(LIVE_BASE);
  });

  it("lets only test keys point at a loopback HTTP host", () => {
    const local = `http://127.0.0.1:8765/auth/v2/authentication/${APPLICATION_ID}`;

    expect(parsePublishableKey(publishableKeyFor(local, "test")).apiBase).toBe(local);
    expect(parsePublishableKey(publishableKeyFor(local.replace("127.0.0.1", "localhost"))).mode).toBe("test");
    rejects(publishableKeyFor(local, "live"));
    rejects(publishableKeyFor(`http://auth.example.com/auth/v2/authentication/${APPLICATION_ID}`, "test"));
  });

  it("rejects keys that are not Didit publishable keys", () => {
    rejects("");
    rejects("sk_live_abc");
    rejects(`pk_prod_${Buffer.from(LIVE_BASE).toString("base64url")}`);
    rejects(`pk_live_${Buffer.from(LIVE_BASE).toString("base64")}=`);
    rejects("pk_live_bm90IGEgdXJs");
    rejects(undefined as unknown as string);
  });

  it("rejects addresses without an application id, or with credentials, query or fragment", () => {
    rejects(publishableKeyFor("https://auth.didit.me/auth/v2/authentication/", "live"));
    rejects(publishableKeyFor(LIVE_BASE.toUpperCase().replace("HTTPS://AUTH.DIDIT.ME", "https://auth.didit.me"), "live"));
    rejects(publishableKeyFor(LIVE_BASE.replace("https://", "https://user:secret@"), "live"));
    rejects(publishableKeyFor(`${LIVE_BASE}?next=1`, "live"));
    rejects(publishableKeyFor(`${LIVE_BASE}#top`, "live"));
  });
});
