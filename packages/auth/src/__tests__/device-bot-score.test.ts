import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";

import { createDiditAuth } from "../client";
import { loadFixture, replay, runtimeOf } from "./helpers/replay";

// The device payload is collected once per page, so this file starts from a page that a driver
// controls: the first collection already sees navigator.webdriver.
const nav = navigator as unknown as Record<string, unknown>;

beforeAll(() => {
  localStorage.clear();
  Object.defineProperty(navigator, "webdriver", { configurable: true, get: () => true });
});
afterAll(() => {
  delete nav.webdriver;
});

describe("bot score on auth requests", () => {
  it("tells the application's bot protection that a driver controls the browser", async () => {
    const fixture = loadFixture("password-reset");
    const api = replay(fixture);
    const auth = createDiditAuth({ publishableKey: runtimeOf(fixture).publishableKey, fetch: api.fetch });

    await auth.password.requestReset({ email: "person@example.com" });
    api.verify();

    // 0.8 and above is what the Authentication API's bots policy matches.
    expect(api.headers[0]["X-Didit-FP-Bot-Score"]).toBe("0.90");
    expect(api.headers[0]["X-Didit-PID"]).toMatch(/^[A-Za-z0-9_-]{20,32}$/);
  });
});
