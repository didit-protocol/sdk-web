import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { DiditSdk } from "../DiditSdk";
import { VerificationModal } from "../modal";
import { resetDeviceFingerprintForTesting } from "../fingerprint";
import type { DiditTransactionPayload, SubmitTransactionResult } from "../types";

// These tests exercise the real VerificationModal and the real
// submitTransactionRequest/pollTransactionAfterAction implementations (only
// `fetch` is mocked). Under this project's ts-jest ESM configuration,
// jest.mock() does not intercept a module's own statically-imported
// dependencies (DiditSdk.ts's "./modal" and "./transactions" imports are
// resolved before any jest.mock() factory runs), so a module-level mock
// would silently be a no-op here. Driving the real modal via postMessage and
// controlling the real network layer via `fetch` is both more robust and a
// closer approximation of production behavior.

interface DiditSdkInternals {
  _actionModal: VerificationModal | null;
  _actionModalSettle: ((outcome: "finished" | "aborted") => void) | null;
}

interface ModalInternals {
  iframe: HTMLIFrameElement | null;
}

function getActionModal(sdk: DiditSdk): VerificationModal {
  const modal = (sdk as unknown as DiditSdkInternals)._actionModal;
  if (!modal) throw new Error("No action modal is currently presented");
  return modal;
}

/** Simulates the action flow's iframe posting didit:completed back to the parent. */
function completeActionModal(sdk: DiditSdk): void {
  const modal = getActionModal(sdk);
  const iframe = (modal as unknown as ModalInternals).iframe;
  if (!iframe) throw new Error("Action modal has no iframe");
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "didit:completed", timestamp: Date.now() },
      origin: "https://verify.didit.me",
      source: iframe.contentWindow as unknown as WindowProxy | null
    })
  );
}

function jsonResponse(payload: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => payload } as Response;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const payload: DiditTransactionPayload = {
  txnId: "txn-1",
  category: "finance",
  details: { direction: "in", amount: 10, currency: "USD" },
  subject: { externalUserId: "u1" }
};

// wallet_ownership is the only action type the SDK auto-launches (it is a
// same-origin, Didit-hosted widget). verification_session actions have their
// own dedicated tests below asserting they are never auto-launched.
const submitResponseBody = {
  uuid: "txn-uuid-1",
  status: "AWAITING_USER",
  action_required: { type: "wallet_ownership", url: "https://verify.didit.me/wallet-ownership/1" }
};

const submitResultWithAction: SubmitTransactionResult = {
  transactionId: "txn-uuid-1",
  status: "AWAITING_USER",
  actionRequired: { type: "wallet_ownership", url: "https://verify.didit.me/wallet-ownership/1" }
};

describe("DiditSdk transaction action lifecycle", () => {
  let sdk: DiditSdk;
  let fetchMock: jest.Mock<typeof fetch>;

  beforeEach(() => {
    resetDeviceFingerprintForTesting();
    fetchMock = jest.fn<typeof fetch>();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockImplementation((_url, init) => {
      // The initial POST /v1/transactions/ submit always succeeds; GET polls
      // are configured per test.
      if ((init as RequestInit | undefined)?.method === "POST") {
        return Promise.resolve(jsonResponse(submitResponseBody));
      }
      return Promise.resolve(jsonResponse({ uuid: "txn-uuid-1", status: "APPROVED" }));
    });

    DiditSdk.shared.destroy();
    sdk = DiditSdk.shared;
  });

  afterEach(() => {
    sdk.destroy();
    jest.restoreAllMocks();
    // @ts-expect-error cleanup of the test-injected global
    delete globalThis.fetch;
    resetDeviceFingerprintForTesting();
  });

  it("isPresented reflects only the verification modal; the action modal has its own getter", async () => {
    await sdk.submitTransaction({ transactionToken: "tok", transaction: payload });
    await flush();

    expect(sdk.isPresented).toBe(false);
    expect(sdk.isActionModalPresented).toBe(true);
  });

  it("close() aborts a pending action modal (no poll, no onActionCompleted) and still closes the verification modal", async () => {
    const onComplete = jest.fn();
    const onActionCompleted = jest.fn();
    sdk.onComplete = onComplete;

    await sdk.submitTransaction({ transactionToken: "tok", transaction: payload, onActionCompleted });
    await flush();
    expect(sdk.isActionModalPresented).toBe(true);

    sdk.close();
    await flush();

    expect(onActionCompleted).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the initial submit POST, no poll GET
    expect(sdk.isActionModalPresented).toBe(false);
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ type: "cancelled" }));
  });

  it("destroy() prevents a poll already in flight from delivering onActionCompleted", async () => {
    const onActionCompleted = jest.fn();
    let resolveGet: ((response: Response) => void) | undefined;

    fetchMock.mockImplementation((_url, init) => {
      if ((init as RequestInit | undefined)?.method === "POST") {
        return Promise.resolve(jsonResponse(submitResponseBody));
      }
      return new Promise<Response>((resolve) => {
        resolveGet = resolve;
      });
    });

    await sdk.submitTransaction({ transactionToken: "tok", transaction: payload, onActionCompleted });
    await flush();

    // User finishes the action modal's flow -> the follow-up poll starts and
    // its GET is held pending by resolveGet.
    completeActionModal(sdk);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The integration is torn down while the poll is still in flight.
    sdk.destroy();

    resolveGet?.(jsonResponse({ uuid: "txn-uuid-1", status: "APPROVED" }));
    await flush();

    expect(onActionCompleted).not.toHaveBeenCalled();
  });

  it("delivers onActionCompleted at most once even when the callback itself throws", async () => {
    const onActionCompleted = jest.fn(() => {
      throw new Error("integrator bug");
    });

    await sdk.submitTransaction({ transactionToken: "tok", transaction: payload, onActionCompleted });
    await flush();

    completeActionModal(sdk);
    await flush();

    expect(onActionCompleted).toHaveBeenCalledTimes(1);
  });

  it("delivers the refreshed result via onActionCompleted with no error on a normal completion", async () => {
    const onActionCompleted = jest.fn();

    await sdk.submitTransaction({ transactionToken: "tok", transaction: payload, onActionCompleted });
    await flush();

    completeActionModal(sdk);
    await flush();

    expect(onActionCompleted).toHaveBeenCalledTimes(1);
    expect(onActionCompleted).toHaveBeenCalledWith({ transactionId: "txn-uuid-1", status: "APPROVED" }, undefined);
  });

  it("surfaces a terminal poll error via onActionCompleted instead of silently returning the stale result", async () => {
    fetchMock.mockImplementation((_url, init) => {
      if ((init as RequestInit | undefined)?.method === "POST") {
        return Promise.resolve(jsonResponse(submitResponseBody));
      }
      return Promise.resolve(jsonResponse({ detail: "Transaction token expired." }, 401));
    });
    const onActionCompleted = jest.fn();

    await sdk.submitTransaction({ transactionToken: "tok", transaction: payload, onActionCompleted });
    await flush();

    completeActionModal(sdk);
    await flush();

    expect(onActionCompleted).toHaveBeenCalledTimes(1);
    expect(onActionCompleted).toHaveBeenCalledWith(submitResultWithAction, {
      type: "expired_token",
      message: "Transaction token expired."
    });
    // Terminal auth failure: must not have retried the poll (each GET burns a use).
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("clears the settle callback when the action modal fails to open, so close() still closes the verification modal", async () => {
    jest.spyOn(VerificationModal.prototype, "open").mockImplementationOnce(() => {
      throw new Error("document.body is not ready");
    });

    const onComplete = jest.fn();
    sdk.onComplete = onComplete;

    await sdk.submitTransaction({ transactionToken: "tok", transaction: payload });
    await flush();

    expect((sdk as unknown as DiditSdkInternals)._actionModalSettle).toBeNull();

    sdk.close();

    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ type: "cancelled" }));
  });
});

describe("DiditSdk transaction action auto-launch contract (wallet_ownership vs verification_session)", () => {
  let sdk: DiditSdk;
  let fetchMock: jest.Mock<typeof fetch>;

  function mockSubmitResponse(actionRequired: { type: string; url: string }): void {
    fetchMock.mockImplementation((_url, init) => {
      if ((init as RequestInit | undefined)?.method === "POST") {
        return Promise.resolve(
          jsonResponse({ uuid: "txn-uuid-2", status: "AWAITING_USER", action_required: actionRequired })
        );
      }
      return Promise.resolve(jsonResponse({ uuid: "txn-uuid-2", status: "APPROVED" }));
    });
  }

  beforeEach(() => {
    resetDeviceFingerprintForTesting();
    fetchMock = jest.fn<typeof fetch>();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    DiditSdk.shared.destroy();
    sdk = DiditSdk.shared;
  });

  afterEach(() => {
    sdk.destroy();
    jest.restoreAllMocks();
    // @ts-expect-error cleanup of the test-injected global
    delete globalThis.fetch;
    resetDeviceFingerprintForTesting();
  });

  it("does not auto-launch a verification_session action: no modal, no poll, result carries actionRequired for the host to handle", async () => {
    mockSubmitResponse({ type: "verification_session", url: "https://verify.didit.me/s/1" });
    const onActionCompleted = jest.fn();

    const result = await sdk.submitTransaction({
      transactionToken: "tok",
      transaction: payload,
      onActionCompleted
    });
    await flush();

    expect(result).toEqual({
      transactionId: "txn-uuid-2",
      status: "AWAITING_USER",
      actionRequired: { type: "verification_session", url: "https://verify.didit.me/s/1" }
    });
    expect(sdk.isActionModalPresented).toBe(false);
    expect(sdk.isPresented).toBe(false);
    // Only the initial submit POST happened - no follow-up poll GET.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onActionCompleted).not.toHaveBeenCalled();
  });

  it("does not auto-launch a verification_session action even when autoLaunchAction is left at its default (true)", async () => {
    mockSubmitResponse({ type: "verification_session", url: "https://verify.didit.me/s/2" });

    await sdk.submitTransaction({ transactionToken: "tok", transaction: payload, autoLaunchAction: true });
    await flush();

    expect(sdk.isActionModalPresented).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still auto-launches a wallet_ownership action: opens the modal, polls after completion, and fires onActionCompleted", async () => {
    mockSubmitResponse({ type: "wallet_ownership", url: "https://verify.didit.me/wallet-ownership/2" });
    const onActionCompleted = jest.fn();

    const result = await sdk.submitTransaction({
      transactionToken: "tok",
      transaction: payload,
      onActionCompleted
    });
    await flush();

    expect(result.actionRequired).toEqual({
      type: "wallet_ownership",
      url: "https://verify.didit.me/wallet-ownership/2"
    });
    expect(sdk.isActionModalPresented).toBe(true);

    completeActionModal(sdk);
    await flush();

    expect(sdk.isActionModalPresented).toBe(false);
    // The initial submit POST plus the post-action poll GET.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onActionCompleted).toHaveBeenCalledTimes(1);
    expect(onActionCompleted).toHaveBeenCalledWith({ transactionId: "txn-uuid-2", status: "APPROVED" }, undefined);
  });
});
