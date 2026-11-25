import { describe, expect, it } from "@jest/globals";

import { deviceHeaders, type DeviceReaders, SIGNALS_HEADER } from "../device";

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
    signals: { platform: "web", tier: "full", compositeHashVersion: 4, webview: { kind: "browser" } },
    compositeHash: "hash-of-the-device",
  } as unknown as Payload;
}

function readers(evidence: unknown, readPayload: DeviceReaders["payload"] = async () => payload()): DeviceReaders {
  return { payload: readPayload, evidence: (async () => evidence) as DeviceReaders["evidence"] };
}

describe("device evidence on auth requests", () => {
  it("sends the evidence text beside the device headers", async () => {
    const headers = await deviceHeaders(readers(EVIDENCE));

    expect(headers[SIGNALS_HEADER]).toBe(EVIDENCE);
    expect(headers["X-Didit-PID"]).toBe("AAAAAAAAAAAAAAAAAAAAAA");
    expect(headers["X-Didit-FP-Hash"]).toBe("hash-of-the-device");
    expect(headers["X-Didit-FP-Bot-Score"]).toBeUndefined();
  });

  it("sends the device headers alone when there is no evidence", async () => {
    const headers = await deviceHeaders(readers(null));

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
    const headers = await deviceHeaders(readers(value));

    expect(SIGNALS_HEADER in headers).toBe(false);
    expect(headers["X-Didit-PID"]).toBe("AAAAAAAAAAAAAAAAAAAAAA");
  });

  it("sends exactly 1024 characters and not one more", async () => {
    const atTheLimit = `{"v":2,"p":"web","cv":"${"x".repeat(1024 - 25)}"}`;

    expect(atTheLimit).toHaveLength(1024);
    expect((await deviceHeaders(readers(atTheLimit)))[SIGNALS_HEADER]).toBe(atTheLimit);
    expect(SIGNALS_HEADER in (await deviceHeaders(readers(atTheLimit + " ")))).toBe(false);
  });

  it("neither part can fail the other, or the request", async () => {
    const failing: DeviceReaders["payload"] = async () => {
      throw new Error("storage is blocked");
    };
    const evidenceOnly = await deviceHeaders(readers(EVIDENCE, failing));
    expect(evidenceOnly).toEqual({ [SIGNALS_HEADER]: EVIDENCE });

    const rejecting: DeviceReaders = {
      payload: async () => payload(),
      evidence: (async () => {
        throw new Error("the collector failed");
      }) as DeviceReaders["evidence"],
    };
    const fingerprintOnly = await deviceHeaders(rejecting);
    expect(SIGNALS_HEADER in fingerprintOnly).toBe(false);
    expect(fingerprintOnly["X-Didit-PID"]).toBe("AAAAAAAAAAAAAAAAAAAAAA");

    expect(await deviceHeaders({ payload: failing, evidence: rejecting.evidence })).toEqual({});
    expect(await deviceHeaders(readers(EVIDENCE, async () => null))).toEqual({ [SIGNALS_HEADER]: EVIDENCE });
  });
});
