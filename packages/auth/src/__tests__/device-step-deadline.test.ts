import { afterEach, describe, expect, it, jest } from "@jest/globals";

import { deviceHeaders } from "../device";

/**
 * A file of its own, so the fingerprint is built here for the first time and the hash this test
 * holds back is the page's first. The one test installs the pending digest itself: it does not
 * depend on another test having run.
 *
 * What was sent is asserted by boolean: a failure must not print a header's value.
 */
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("a step of a sign-in, and a hash that never comes", () => {
  it("is held for two seconds at most, and then goes out with the device's id and without the hash", async () => {
    localStorage.clear();
    jest.useFakeTimers();
    jest.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(() => new Promise(() => undefined));

    let done = false;
    const waiting = deviceHeaders(true).then((headers) => {
      done = true;
      return headers;
    });
    await jest.advanceTimersByTimeAsync(1999);
    expect(done).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    const headers = await waiting;

    expect("X-Didit-FP-Hash" in headers).toBe(false);
    expect(headers["X-Didit-PID"] === localStorage.getItem("didit-pid-v1")).toBe(true);
  });
});
