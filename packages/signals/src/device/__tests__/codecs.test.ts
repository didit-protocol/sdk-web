import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { collectCodecSignals, MEDIA_PROBES, RECORDER_PROBES } from "../signals/codecs";

describe("collectCodecSignals", () => {
  afterEach(() => {
    delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
    jest.restoreAllMocks();
  });

  it("probes every media type when canPlayType is available", () => {
    jest
      .spyOn(HTMLMediaElement.prototype, "canPlayType")
      .mockImplementation((type: string) => (type.startsWith("video/mp4") ? "probably" : ""));
    const result = collectCodecSignals();
    expect(result.blocked).toBe(false);
    expect(Object.keys(result.media).sort()).toEqual([...MEDIA_PROBES].sort());
    expect(result.media['video/mp4; codecs="avc1.42E01E"']).toBe("probably");
    expect(result.media['video/webm; codecs="vp8"']).toBe("");
  });

  it("probes MediaRecorder.isTypeSupported when present", () => {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = {
      isTypeSupported: (type: string) => type.includes("webm"),
    };
    const result = collectCodecSignals();
    expect(Object.keys(result.recorder).sort()).toEqual([...RECORDER_PROBES].sort());
    expect(result.recorder["video/webm;codecs=vp9"]).toBe(true);
    expect(result.recorder["video/mp4;codecs=avc1"]).toBe(false);
  });

  it("records an error marker instead of dying when canPlayType throws", () => {
    jest.spyOn(HTMLMediaElement.prototype, "canPlayType").mockImplementation(() => {
      throw new Error("blocked");
    });
    const result = collectCodecSignals();
    expect(result.media[MEDIA_PROBES[0]]).toBe("error");
  });

  it("survives a throwing getter on HTMLMediaElement.prototype.canPlayType", () => {
    // A hostile page booby-traps the capability accessor itself (not the call).
    // The bare `typeof probe.canPlayType` read would otherwise throw and take the
    // whole synchronously-composed payload down. Recorder still populates.
    const origDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "canPlayType");
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = {
      isTypeSupported: (type: string) => type.includes("webm"),
    };
    try {
      Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", {
        configurable: true,
        get() {
          throw new Error("hostile getter");
        },
      });
      let result: ReturnType<typeof collectCodecSignals> | undefined;
      expect(() => {
        result = collectCodecSignals();
      }).not.toThrow();
      expect(result?.media).toEqual({});
      expect(result?.recorder["video/webm;codecs=vp9"]).toBe(true);
      expect(result?.blocked).toBe(false);
    } finally {
      if (origDesc) Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", origDesc);
    }
  });

  it("maps a non-string canPlayType return to a serialization-safe marker", () => {
    // A patched canPlayType can RETURN a hostile value (e.g. BigInt) rather than
    // throw. Stored verbatim it would later make JSON.stringify throw and lose the
    // whole payload. Only "", "maybe", "probably" are kept; everything else -> "error".
    jest
      .spyOn(HTMLMediaElement.prototype, "canPlayType")
      .mockImplementation((() => BigInt(1)) as unknown as () => CanPlayTypeResult);
    const result = collectCodecSignals();
    expect(
      Object.values(result.media).every((v) => v === "" || v === "maybe" || v === "probably" || v === "error"),
    ).toBe(true);
    expect(result.media[MEDIA_PROBES[0]]).toBe("error");
    // The whole point: the resulting payload is JSON-serializable.
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("survives a throwing getter on globalThis.MediaRecorder", () => {
    jest.spyOn(HTMLMediaElement.prototype, "canPlayType").mockImplementation(() => "maybe");
    try {
      Object.defineProperty(globalThis, "MediaRecorder", {
        configurable: true,
        get() {
          throw new Error("hostile getter");
        },
      });
      let result: ReturnType<typeof collectCodecSignals> | undefined;
      expect(() => {
        result = collectCodecSignals();
      }).not.toThrow();
      expect(result?.recorder).toEqual({});
      expect(result?.media[MEDIA_PROBES[0]]).toBe("maybe");
      expect(result?.blocked).toBe(false);
    } finally {
      delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
    }
  });

  it("reports blocked when both capability accessors are booby-trapped", () => {
    const origDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "canPlayType");
    try {
      Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", {
        configurable: true,
        get() {
          throw new Error("hostile getter");
        },
      });
      Object.defineProperty(globalThis, "MediaRecorder", {
        configurable: true,
        get() {
          throw new Error("hostile getter");
        },
      });
      let result: ReturnType<typeof collectCodecSignals> | undefined;
      expect(() => {
        result = collectCodecSignals();
      }).not.toThrow();
      expect(result?.media).toEqual({});
      expect(result?.recorder).toEqual({});
      expect(result?.blocked).toBe(true);
    } finally {
      if (origDesc) Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", origDesc);
      delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
    }
  });
});
