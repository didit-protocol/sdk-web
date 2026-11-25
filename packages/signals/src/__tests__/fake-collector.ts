import { jest } from "@jest/globals";
import type { DeviceCollector } from "../collector";
import { readStoredPersistentId } from "../device/storage";
import type { DeviceFingerprintPayload } from "../device/types";

/** What the fake collector reports as its evidence: the shape the real one has, with no real facts. */
export const FAKE_EVIDENCE = '{"v":2,"p":"web","facts":[]}';

/** A full-tier payload that carries the evidence and the stored id the page already has. */
export function fullPayload(): DeviceFingerprintPayload {
  return {
    version: 2,
    schema: "didit-fp-v2",
    platform: "web",
    collectedAt: "2026-01-01T00:00:00.000Z",
    persistentId: readStoredPersistentId() ?? "",
    persistentIdSources: ["localStorage"],
    persistentIdWasCreated: false,
    signals: {
      platform: "web",
      tier: "full",
      compositeHashVersion: 4,
      navigator: {} as never,
      webview: { kind: "browser", hostAppVersion: null, isStandaloneBrowser: true },
    },
    compositeHash: "full-hash-of-the-device",
    evidence: FAKE_EVIDENCE,
  };
}

/**
 * A collector the test controls: `collect` answers through `settle`, so a test decides when the
 * payload arrives. `storedIdWhenCollecting` records whether the stored id existed by then.
 */
export function fakeCollector() {
  let resolveCollect: (payload: DeviceFingerprintPayload) => void = () => undefined;
  let rejectCollect: (error: Error) => void = () => undefined;
  let current: DeviceFingerprintPayload | null = null;
  const storedIdWhenCollecting: (string | null)[] = [];

  const collect = jest.fn<DeviceCollector["collect"]>(() => {
    storedIdWhenCollecting.push(readStoredPersistentId());
    return new Promise<DeviceFingerprintPayload>((resolve, reject) => {
      resolveCollect = (payload) => {
        current = payload;
        resolve(payload);
      };
      rejectCollect = reject;
    });
  });
  const collector: DeviceCollector = {
    version: "test",
    collect,
    peek: () => current,
    evidence: () => FAKE_EVIDENCE,
  };

  return {
    collector,
    collect,
    storedIdWhenCollecting,
    /** The collection finishes with the full payload. */
    settle: () => resolveCollect(fullPayload()),
    fail: (error = new Error("collection failed")) => rejectCollect(error),
  };
}
