import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { getDeviceFingerprintPayload } from "@didit-protocol/signals";

import { createDiditAuth } from "../client";
import { SIGNALS_HEADER, setDeviceReadersForTesting } from "../device";
import { loadFixture, replay, runtimeOf } from "./helpers/replay";

const EVIDENCE = '{"v":2,"p":"web","cv":"w0.3.0","wd":0,"aa":[]}';
const STORAGE_KEY = "didit-pid-v1";
const KEPT_ID = "KKKKKKKKKKKKKKKKKKKKKK";

/**
 * When the evidence arrives is the signals package's to decide (its own tests cover the two
 * seconds it waits for its collector). Here the test decides it: the client runs with an evidence
 * reader that answers only when the test says so, and with the real small fingerprint.
 * A password reset stands for a step of a sign-in: a POST made before there is a session.
 *
 * What was sent is asserted by count and by boolean: a failure must not print the headers, which
 * carry the hash of the machine the tests run on.
 */
function client() {
  const fixture = loadFixture("password-reset");
  const api = replay(fixture);
  const auth = createDiditAuth({ publishableKey: runtimeOf(fixture).publishableKey, fetch: api.fetch });
  const { email } = fixture.exchanges[0].request.body as { email: string };
  const asked: boolean[] = [];
  let answer: (evidence: string | null) => void = () => undefined;
  const arrives = new Promise<string | null>((resolve) => {
    answer = resolve;
  });

  setDeviceReadersForTesting({
    payload: (wait) => getDeviceFingerprintPayload({ tier: "lite", wait }),
    evidence: (wait) => {
      asked.push(wait);
      // A reader that is asked not to wait answers at once with what there is: nothing yet.
      return wait ? arrives : Promise.resolve(null);
    },
  });
  return { api, asked, answer, step: () => auth.password.requestReset({ email }) };
}

/** Lets what is already due run: promise jobs and the hash of the small fingerprint. */
function moment(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

beforeEach(() => {
  localStorage.clear();
  document.cookie = "didit_pid=; Path=/; Max-Age=0";
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  setDeviceReadersForTesting(null);
});

describe("a step of a sign-in and the device evidence", () => {
  it("is held until the evidence arrives, and carries it", async () => {
    const { api, asked, answer, step } = client();

    const sent = step();
    await moment();
    // Nothing has been sent: the step is waiting for the evidence.
    expect(api.headers.length).toBe(0);
    expect(asked).toEqual([true]);

    answer(EVIDENCE);
    await sent;

    expect(api.headers.length).toBe(1);
    expect(api.headers[0][SIGNALS_HEADER] === EVIDENCE).toBe(true);
    expect(api.headers[0]["X-Didit-PID"] === localStorage.getItem(STORAGE_KEY)).toBe(true);
  });

  it("goes out without the evidence when there is none in time, and still says which device it is", async () => {
    const { api, answer, step } = client();

    const sent = step();
    await moment();
    expect(api.headers.length).toBe(0);
    // What the signals package answers when its collector is late, blocked or failed.
    answer(null);
    await sent;

    expect(api.headers.length).toBe(1);
    expect(SIGNALS_HEADER in api.headers[0]).toBe(false);
    expect(api.headers[0]["X-Didit-PID"] === localStorage.getItem(STORAGE_KEY)).toBe(true);
    api.verify();
  });

  it("carries the id the collector settled on while the step waited, not the one the page had before", async () => {
    const { api, answer, step } = client();

    const sent = step();
    await moment();
    const before = localStorage.getItem(STORAGE_KEY);
    // What the collector does when a slower store still held the device's id: it writes that id
    // to the page's stores, and only then is its evidence there.
    localStorage.setItem(STORAGE_KEY, KEPT_ID);
    answer(EVIDENCE);
    await sent;

    expect(before !== KEPT_ID).toBe(true);
    expect(api.headers.length).toBe(1);
    expect(api.headers[0]["X-Didit-PID"] === KEPT_ID).toBe(true);
  });
});
