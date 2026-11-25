import { jest } from "@jest/globals";
import type { CollectedPayload, DeviceCollector } from "../collector";
import { readStoredPersistentId } from "../device/storage";

type CollectOptions = Parameters<DeviceCollector["collect"]>[0];
/** How a collection names the device: its id, where it was kept, and whether it is new. */
export type Identity = Pick<CollectedPayload, "persistentId" | "persistentIdSources" | "persistentIdWasCreated">;

/** What the fake collector reports as its evidence: the shape the real one has, with no real facts. */
export const FAKE_EVIDENCE = '{"v":2,"p":"web","facts":[]}';

/**
 * A full-tier payload with the evidence. It names the device as the real collector does on a page
 * whose slower stores are empty: by the id the page made up when it was told one (a new device),
 * else by the id the page stores. `identity` says otherwise, for a collector that found another id.
 */
export function fullPayload(options?: CollectOptions, identity?: Partial<Identity>): CollectedPayload {
  const madeUp = options?.newPersistentId ?? null;
  return {
    version: 2,
    schema: "didit-fp-v2",
    platform: "web",
    collectedAt: "2026-01-01T00:00:00.000Z",
    persistentId: madeUp ?? readStoredPersistentId()?.id ?? "",
    persistentIdSources: madeUp ? ["fresh"] : ["localStorage"],
    persistentIdWasCreated: Boolean(madeUp),
    ...identity,
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
  let resolveCollect: (payload: CollectedPayload) => void = () => undefined;
  let rejectCollect: (error: Error) => void = () => undefined;
  let current: CollectedPayload | null = null;
  let told: CollectOptions;
  const storedIdWhenCollecting: (string | null)[] = [];

  const collect = jest.fn<DeviceCollector["collect"]>((options) => {
    told = options;
    storedIdWhenCollecting.push(readStoredPersistentId()?.id ?? null);
    return new Promise<CollectedPayload>((resolve, reject) => {
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
    /** The collection finishes with the full payload, naming the device as `identity` says. */
    settle: (identity?: Partial<Identity>) => resolveCollect(fullPayload(told, identity)),
    fail: (error = new Error("collection failed")) => rejectCollect(error),
  };
}
