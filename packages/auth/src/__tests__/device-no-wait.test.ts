import { afterEach, describe, expect, it, jest } from "@jest/globals";

import { deviceHeaders } from "../device";

/**
 * A file of its own, so the fingerprint is built here for the first time: the hash this test
 * holds back is the page's first, as on a page that has just loaded.
 *
 * What was sent is asserted by boolean: a failure must not print a header's value.
 */
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("a hash that never comes", () => {
  it("does not hold a request that does not wait: it goes out at once with the device's id and without the hash", async () => {
    localStorage.clear();
    jest.useFakeTimers();
    jest.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(() => new Promise(() => undefined));

    // No timer is advanced: these headers did not wait for the hash, or for anything else.
    const headers = await deviceHeaders(false);

    expect("X-Didit-FP-Hash" in headers).toBe(false);
    expect(headers["X-Didit-PID"] === localStorage.getItem("didit-pid-v1")).toBe(true);
    expect(headers["X-Didit-FP-V2"]).toBe("1");
  });

  it("holds a step of a sign-in for two seconds at most, and then lets it go without the hash", async () => {
    // The hash the first test held back is still the page's only one, and still has not come.
    jest.useFakeTimers();
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
    expect(typeof headers["X-Didit-PID"]).toBe("string");
  });
});
