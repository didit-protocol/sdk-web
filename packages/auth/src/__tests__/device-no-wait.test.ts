import { afterEach, describe, expect, it, jest } from "@jest/globals";

import { deviceHeaders } from "../device";

/**
 * A file of its own, so the fingerprint is built here for the first time and the hash this test
 * holds back is the page's first, as on a page that has just loaded. The one test installs the
 * pending digest itself: it does not depend on another test having run.
 *
 * What was sent is asserted by boolean: a failure must not print a header's value.
 */
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("a request that does not wait, and a hash that never comes", () => {
  it("goes out at once with the device's id and without the hash", async () => {
    localStorage.clear();
    jest.useFakeTimers();
    jest.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(() => new Promise(() => undefined));

    // No timer is advanced: these headers did not wait for the hash, or for anything else.
    const headers = await deviceHeaders(false);

    expect("X-Didit-FP-Hash" in headers).toBe(false);
    expect(headers["X-Didit-PID"] === localStorage.getItem("didit-pid-v1")).toBe(true);
    expect(headers["X-Didit-FP-V2"]).toBe("1");
  });
});
