import { describe, expect, it } from "@jest/globals";

import { deviceHeaders, type DeviceReaders, SIGNALS_HEADER, waitsForEvidence } from "../device";

const EVIDENCE = '{"v":2,"p":"web","cv":"w0.1.0","wd":0,"aa":[]}';

type Payload = Awaited<ReturnType<DeviceReaders["payload"]>>;

function payload(): Payload {
  return {
    version: 2,
    schema: "didit-fp-v2",
    platform: "web",
    collectedAt: "2026-01-01T00:00:00.000Z",
    persistentId: "AAAAAAAAAAAAAAAAAAAAAA",
    persistentIdSources: ["localStorage"],
    persistentIdWasCreated: false,
    signals: { platform: "web", tier: "lite", compositeHashVersion: 4, webview: { kind: "browser" } },
    compositeHash: "hash-of-the-device",
  } as unknown as Payload;
}

/** A sign-in step waits for the evidence; the tests below that do not care pass this. */
const WAIT = true;

function readers(evidence: unknown, readPayload: DeviceReaders["payload"] = async () => payload()): DeviceReaders {
  return { payload: readPayload, evidence: (async () => evidence) as DeviceReaders["evidence"] };
}

describe("device evidence on auth requests", () => {
  it("sends the evidence text beside the device headers", async () => {
    const headers = await deviceHeaders(WAIT, readers(EVIDENCE));

    expect(headers[SIGNALS_HEADER]).toBe(EVIDENCE);
    expect(headers["X-Didit-PID"]).toBe("AAAAAAAAAAAAAAAAAAAAAA");
    expect(headers["X-Didit-FP-Hash"]).toBe("hash-of-the-device");
    expect(headers["X-Didit-FP-Bot-Score"]).toBeUndefined();
  });

  it("sends the device headers alone when there is no evidence", async () => {
    const headers = await deviceHeaders(WAIT, readers(null));

    expect(SIGNALS_HEADER in headers).toBe(false);
    expect(headers["X-Didit-PID"]).toBe("AAAAAAAAAAAAAAAAAAAAAA");
  });

  it.each([
    ["an empty text", ""],
    ["text a header cannot carry", '{"v":2,"p":"web","cv":"café"}'],
    ["a line break", '{"v":2,\n"p":"web"}'],
    ["more than the API reads", `{"v":2,"p":"web","cv":"${"x".repeat(1024)}"}`],
    ["an object", { v: 2 }],
    ["a number", 7],
  ])("leaves the header out for %s, and still sends the rest", async (_name, value) => {
    const headers = await deviceHeaders(WAIT, readers(value));

    expect(SIGNALS_HEADER in headers).toBe(false);
    expect(headers["X-Didit-PID"]).toBe("AAAAAAAAAAAAAAAAAAAAAA");
  });

  it("sends exactly 1024 characters and not one more", async () => {
    const atTheLimit = `{"v":2,"p":"web","cv":"${"x".repeat(1024 - 25)}"}`;

    expect(atTheLimit).toHaveLength(1024);
    expect((await deviceHeaders(WAIT, readers(atTheLimit)))[SIGNALS_HEADER]).toBe(atTheLimit);
    expect(SIGNALS_HEADER in (await deviceHeaders(WAIT, readers(atTheLimit + " ")))).toBe(false);
  });

  it("neither part can fail the other, or the request", async () => {
    const failing: DeviceReaders["payload"] = async () => {
      throw new Error("storage is blocked");
    };
    const evidenceOnly = await deviceHeaders(WAIT, readers(EVIDENCE, failing));
    expect(evidenceOnly).toEqual({ [SIGNALS_HEADER]: EVIDENCE });

    const rejecting: DeviceReaders = {
      payload: async () => payload(),
      evidence: (async () => {
        throw new Error("the collector failed");
      }) as DeviceReaders["evidence"],
    };
    const fingerprintOnly = await deviceHeaders(WAIT, rejecting);
    expect(SIGNALS_HEADER in fingerprintOnly).toBe(false);
    expect(fingerprintOnly["X-Didit-PID"]).toBe("AAAAAAAAAAAAAAAAAAAAAA");

    expect(await deviceHeaders(WAIT, { payload: failing, evidence: rejecting.evidence })).toEqual({});
    expect(await deviceHeaders(WAIT, readers(EVIDENCE, async () => null))).toEqual({ [SIGNALS_HEADER]: EVIDENCE });
  });

  it("forwards only the device headers the Authentication API permits across origins", async () => {
    // What the signals package builds once its collector has loaded: a legacy hash too, and
    // whatever a later version adds. One header the API does not list makes the browser refuse
    // the whole request from another origin, so none of them is forwarded.
    const full = {
      ...payload(),
      legacyCompatibilityHash: "didit-fp-legacy-hash",
      signals: { platform: "web", tier: "full", compositeHashVersion: 4, webview: { kind: "browser" } },
    } as unknown as Payload;

    const headers = await deviceHeaders(WAIT, readers(EVIDENCE, async () => full));

    expect(Object.keys(headers).sort()).toEqual([
      "X-Didit-FP-Hash",
      "X-Didit-FP-V2",
      "X-Didit-FP-Webview",
      "X-Didit-PID",
      SIGNALS_HEADER,
    ]);
  });

  it("asks for the evidence with a wait only when the request is told to wait", async () => {
    const asked: boolean[] = [];
    const recording: DeviceReaders = {
      payload: async () => payload(),
      evidence: async (wait) => {
        asked.push(wait);
        return wait ? EVIDENCE : null;
      },
    };

    const waited = await deviceHeaders(true, recording);
    const immediate = await deviceHeaders(false, recording);

    expect(asked).toEqual([true, false]);
    expect(waited[SIGNALS_HEADER]).toBe(EVIDENCE);
    // Without the evidence the request still says which device it comes from.
    expect(SIGNALS_HEADER in immediate).toBe(false);
    expect(immediate["X-Didit-PID"]).toBe("AAAAAAAAAAAAAAAAAAAAAA");
  });
});

describe("which requests wait for the device evidence", () => {
  it.each([
    "authorize/",
    "password/",
    "email/start/",
    "email/complete/",
    "phone/start/",
    "phone/complete/",
    "passkeys/begin/",
    "passkeys/complete/",
    "mfa/complete/",
    "mfa/setup/",
    "protection/complete/",
    "password-reset/start/",
  ])("a step of a sign-in waits: POST %s, before there is a session", (path) => {
    expect(waitsForEvidence("POST", path, false)).toBe(true);
  });

  it.each([
    ["GET", "session/", true],
    ["DELETE", "session/", true],
    ["POST", "token/", false],
  ])("what runs when a page loads never waits: %s %s", (method, path, authenticated) => {
    expect(waitsForEvidence(method, path, authenticated)).toBe(false);
  });

  it.each(["passkeys/register/", "passkeys/confirm/", "mfa/enroll/", "mfa/confirm/", "step-up/", "agents/consent/"])(
    "what a signed-in person does to their own account never waits: POST %s with their access token",
    (path) => {
      expect(waitsForEvidence("POST", path, true)).toBe(false);
    },
  );
});
