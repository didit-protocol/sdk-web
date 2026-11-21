import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { installWebCryptoForTests } from "./_test_setup";
installWebCryptoForTests();

import { type FontSignals } from "../signals/fonts";
import { type PersistentIdResult } from "../storage";

const FONTS: FontSignals = { available: ["Arial"], count: 1, blocked: false };
const collectFontSignals = jest.fn<() => Promise<FontSignals>>();
const loadOrCreatePersistentIdFromBrowserStorage = jest.fn<() => Promise<PersistentIdResult>>();

jest.unstable_mockModule("../signals/fonts", () => ({ BATCH_SIZE: 12, collectFontSignals, FONT_CANDIDATES: [] }));
jest.unstable_mockModule("../storage-layers", () => ({
  BROWSER_STORAGE_LAYERS: [],
  LAYER_TIMEOUT_MS: 50,
  loadOrCreatePersistentIdFromBrowserStorage,
}));

const { buildPayload } = await import("../index");

type SchedulerGlobal = typeof globalThis & { scheduler?: { yield: () => Promise<void> } };

describe("buildPayload", () => {
  const scope = globalThis as SchedulerGlobal;
  let order: string[];

  beforeEach(() => {
    order = [];
    scope.scheduler = {
      yield: jest.fn(() => {
        order.push("yield");
        return Promise.resolve();
      }),
    };
    collectFontSignals.mockImplementation(async () => {
      order.push("fonts");
      return FONTS;
    });
    loadOrCreatePersistentIdFromBrowserStorage.mockResolvedValue({
      id: "pid-stored-aaaaaaaaaaaa",
      sources: ["localStorage"],
      wasCreated: false,
    });
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    delete scope.scheduler;
    jest.restoreAllMocks();
  });

  it("hands the main thread back between collectors, the font probe in a task of its own", async () => {
    const payload = await buildPayload();
    expect(scope.scheduler!.yield).toHaveBeenCalledTimes(5);
    const fontsAt = order.indexOf("fonts");
    expect(order[fontsAt - 1]).toBe("yield");
    expect(order[fontsAt + 1]).toBe("yield");
    expect(payload.signals.fonts).toEqual(FONTS);
  });

  it("keeps the font probe out of the collectors' time budget, however late its task runs", async () => {
    // A busy page runs the probe's task late: here every yield takes 500 ms against a 50 ms budget per
    // collector, which must not turn the probe into "blocked" (it would change the device's hash).
    jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
    scope.scheduler = {
      yield: () => {
        return new Promise((resolve) => {
          setTimeout(resolve, 500);
        });
      },
    };
    try {
      const pending = buildPayload({ budgetMs: 100 });
      await jest.advanceTimersByTimeAsync(5000);
      const payload = await pending;
      expect(payload.signals.fonts.blocked).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it("sends the stored id however long its read takes against the collectors' time budget", async () => {
    // On a busy page the budget's timer used to run before the storage read's answer and the request
    // went out with an empty stored id, the id still in storage. Here the read answers after 2 s,
    // against a 50 ms budget per collector.
    jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
    loadOrCreatePersistentIdFromBrowserStorage.mockImplementation(() => {
      return new Promise((resolve) => {
        setTimeout(() => resolve({ id: "pid-slow-aaaaaaaaaaaaaa", sources: ["idb"], wasCreated: false }), 2000);
      });
    });
    try {
      const pending = buildPayload({ budgetMs: 100 });
      await jest.advanceTimersByTimeAsync(5000);
      const payload = await pending;
      expect(payload.persistentId).toBe("pid-slow-aaaaaaaaaaaaaa");
      expect(payload.persistentIdSources).toEqual(["idb"]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("sends the payload without a stored id when storage fails outright", async () => {
    loadOrCreatePersistentIdFromBrowserStorage.mockRejectedValue(new Error("storage is gone"));
    const payload = await buildPayload();
    expect(payload.persistentId).toBe("");
    expect(payload.compositeHash).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("still yields where the browser has no scheduler.yield", async () => {
    delete scope.scheduler;
    const timeout = jest.spyOn(globalThis, "setTimeout");
    const payload = await buildPayload();
    expect(timeout.mock.calls.filter(([, ms]) => ms === 0).length).toBeGreaterThanOrEqual(5);
    expect(payload.signals.fonts.blocked).toBe(false);
  });
});
