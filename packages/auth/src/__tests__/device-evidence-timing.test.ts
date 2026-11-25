import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { getDeviceFingerprintPayload } from "@didit-protocol/signals";

import { createDiditAuth } from "../client";
import { SIGNALS_HEADER, setDeviceReadersForTesting } from "../device";
import { loadFixture, replay, runtimeOf } from "./helpers/replay";

const EVIDENCE = '{"v":2,"p":"web","cv":"w0.1.0","wd":0,"aa":[]}';

/**
 * When the evidence arrives is the signals package's to decide (its own tests cover the two
 * seconds it waits for its collector). Here the test decides it: the client runs with an evidence
 * reader that answers only when the test says so, and with the real small fingerprint.
 * A password reset stands for a step of a sign-in: a POST made before there is a session.
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
    payload: () => getDeviceFingerprintPayload({ tier: "lite" }),
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

beforeEach(() => localStorage.clear());
afterEach(() => setDeviceReadersForTesting(null));

describe("a step of a sign-in and the device evidence", () => {
  it("is held until the evidence arrives, and carries it", async () => {
    const { api, asked, answer, step } = client();

    const sent = step();
    await moment();
    // Nothing has been sent: the step is waiting for the evidence.
    expect(api.headers).toHaveLength(0);
    expect(asked).toEqual([true]);

    answer(EVIDENCE);
    await sent;

    expect(api.headers).toHaveLength(1);
    expect(api.headers[0][SIGNALS_HEADER]).toBe(EVIDENCE);
    expect(api.headers[0]["X-Didit-PID"]).toBe(localStorage.getItem("didit-pid-v1"));
  });

  it("goes out without the evidence when there is none in time, and still says which device it is", async () => {
    const { api, answer, step } = client();

    const sent = step();
    await moment();
    expect(api.headers).toHaveLength(0);
    // What the signals package answers when its collector is late, blocked or failed.
    answer(null);
    await sent;

    expect(api.headers).toHaveLength(1);
    expect(SIGNALS_HEADER in api.headers[0]).toBe(false);
    expect(api.headers[0]["X-Didit-PID"]).toBe(localStorage.getItem("didit-pid-v1"));
    api.verify();
  });
});
