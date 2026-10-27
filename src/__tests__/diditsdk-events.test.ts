import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as sdk from "../index";
import { DiditSdk } from "../DiditSdk";
import { resetEventsForTesting } from "../../packages/signals/src/events";
import { recordedEvents, replay, scenario } from "../../packages/signals/src/__tests__/device-lane";

describe("DiditSdk.shared.submitEvent", () => {
  let fetchMock: jest.Mock<typeof fetch>;

  beforeEach(() => {
    resetEventsForTesting();
    fetchMock = jest.fn<typeof fetch>();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    resetEventsForTesting();
    DiditSdk.reset();
    // @ts-expect-error cleanup of the test-injected global
    delete globalThis.fetch;
  });

  it("queues on the shared @didit-protocol/signals queue that the re-exported flush sends", async () => {
    fetchMock.mockImplementation(replay("accepted"));

    const ids = recordedEvents("accepted").map((event) =>
      DiditSdk.shared.submitEvent({ monitoringToken: scenario("accepted").token, event })
    );
    const result = await sdk.flush();

    expect(ids).toEqual(["rec-signup-1", "rec-login-1", "rec-login-failed-1"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ acceptedCount: 3, pendingCount: 0 });
  });

  it("throws the typed error for a missing token", () => {
    expect(() =>
      DiditSdk.shared.submitEvent({ monitoringToken: "", event: { category: "auth", actionType: "login" } })
    ).toThrow(sdk.DiditEventError);
  });

  it("re-exports the signals API next to the verification and transaction API", () => {
    expect(Object.keys(sdk).sort()).toEqual(
      [
        "DEFAULT_EVENTS_BASE_URL",
        "DEFAULT_TRANSACTION_BASE_URL",
        "DiditEventError",
        "DiditSdk",
        "DiditTransactionError",
        "SDK_VERSION",
        "buildFingerprintHeaders",
        "configureEvents",
        "default",
        "flush",
        "getDeviceFingerprintPayload",
        "submitEvent"
      ].sort()
    );
  });
});
