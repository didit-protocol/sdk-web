import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { createDiditAuth } from "../client";
import type { DeviceSignalsOption } from "../device";
import { loadFixture, publishableKeyFor, replay, runtimeOf } from "./helpers/replay";

// An application served on the page's own origin, for example through a reverse proxy.
const SAME_ORIGIN = "http://localhost:4174";

async function headersSent(deviceSignals: DeviceSignalsOption | undefined, origin?: string) {
  const recorded = loadFixture("password-reset");
  const fixture = origin ? { ...recorded, origin, publishableKey: publishableKeyFor(origin) } : recorded;
  const api = replay(fixture);
  const auth = createDiditAuth({ publishableKey: runtimeOf(fixture).publishableKey, fetch: api.fetch, deviceSignals });

  await auth.password.requestReset({ email: "person@example.com" });
  api.verify();
  return api.headers[0];
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  jest.restoreAllMocks();
});

describe("device signals on auth requests", () => {
  it("sends the persistent device id and fingerprint hash when the API shares the page's origin", async () => {
    const headers = await headersSent(undefined, SAME_ORIGIN);

    expect(headers["X-Didit-FP-V2"]).toBe("1");
    expect(headers["X-Didit-PID"]).toMatch(/^[A-Za-z0-9_-]{20,32}$/);
    expect(headers["X-Didit-PID"]).toBe(localStorage.getItem("didit-pid-v1"));
    expect(headers["X-Didit-FP-Hash"]).toBeTruthy();
    expect(headers["X-Didit-FP-Webview"]).toBe("browser");
  });

  it("does not send them across origins by default, because the API does not allow those headers yet", async () => {
    const headers = await headersSent(undefined);

    expect(Object.keys(headers).sort()).toEqual(["Accept", "Content-Type"]);
  });

  it("sends them across origins when asked, and never when turned off", async () => {
    expect((await headersSent("always"))["X-Didit-PID"]).toMatch(/^[A-Za-z0-9_-]{20,32}$/);
    expect((await headersSent("off", SAME_ORIGIN))["X-Didit-PID"]).toBeUndefined();
  });
});
