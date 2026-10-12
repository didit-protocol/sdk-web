import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  DiditTransactionError,
  buildTransactionRequestBody,
  classifyTransactionError,
  mapTransactionResponse,
  pollTransactionAfterAction,
  submitTransactionRequest
} from "../transactions";
import { resetDeviceFingerprintForTesting } from "../fingerprint";
import type { DiditTransactionPayload } from "../types";

const fullPayload: DiditTransactionPayload = {
  txnId: "txn-123",
  txnDate: "2026-07-07T10:00:00Z",
  zoneId: "Europe/Madrid",
  category: "travelRule",
  details: {
    direction: "out",
    amount: "0.5",
    currency: "BTC",
    currencyType: "crypto",
    amountInDefaultCurrency: 30000,
    defaultCurrencyCode: "USD",
    paymentDetails: "withdrawal",
    paymentTxnId: "0xabc",
    actionType: "withdrawal",
    cryptoParams: { crypto_chain: "BTC" }
  },
  subject: {
    type: "individual",
    externalUserId: "user-1",
    fullName: "Jane Doe",
    paymentMethod: { type: "crypto", accountId: "bc1q...", issuingCountry: "US" }
  },
  counterparty: {
    type: "individual",
    fullName: "John Roe"
  },
  customProperties: { orderRef: "A1" },
  travelRule: {
    status: "PENDING",
    protocol: "TRP",
    required: true,
    obligationsCount: 1,
    originatorData: { name: "Jane Doe" },
    beneficiaryData: { name: "John Roe" },
    metadata: { note: "x" }
  },
  includeCryptoScreening: true
};

describe("buildTransactionRequestBody", () => {
  it("maps camelCase fields onto the wire aliases", () => {
    const body = buildTransactionRequestBody(fullPayload);

    expect(body.txnId).toBe("txn-123");
    expect(body.txnDate).toBe("2026-07-07T10:00:00Z");
    expect(body.zoneId).toBe("Europe/Madrid");
    expect(body.type).toBe("travelRule");
    expect(body.props).toEqual({ orderRef: "A1" });
    expect(body.includeCryptoScreening).toBe(true);
    expect(body).not.toHaveProperty("category");
    expect(body).not.toHaveProperty("details");
    expect(body).not.toHaveProperty("customProperties");

    expect(body.info).toEqual({
      direction: "out",
      amount: "0.5",
      currency: "BTC",
      currencyType: "crypto",
      amountInDefaultCurrency: 30000,
      defaultCurrencyCode: "USD",
      paymentDetails: "withdrawal",
      paymentTxnId: "0xabc",
      type: "withdrawal",
      cryptoParams: { crypto_chain: "BTC" }
    });

    expect(body.subject).toEqual({
      type: "individual",
      externalUserId: "user-1",
      fullName: "Jane Doe",
      paymentMethod: { type: "crypto", accountId: "bc1q...", issuingCountry: "US" }
    });
    expect(body.counterparty).toEqual({ type: "individual", fullName: "John Roe" });

    expect(body.travelRule).toEqual({
      status: "PENDING",
      protocol: "TRP",
      required: true,
      obligationsCount: 1,
      originatorData: { name: "Jane Doe" },
      beneficiaryData: { name: "John Roe" },
      metadata: { note: "x" }
    });
  });

  it("omits undefined optional fields entirely", () => {
    const body = buildTransactionRequestBody({
      txnId: "txn-1",
      category: "finance",
      details: { direction: "in", amount: 10, currency: "USD" },
      subject: { externalUserId: "u1" }
    });

    expect(Object.keys(body).sort()).toEqual(["info", "subject", "txnId", "type"]);
    expect(body.info).toEqual({ direction: "in", amount: 10, currency: "USD" });
    expect(body).not.toHaveProperty("counterparty");
    expect(body).not.toHaveProperty("travelRule");
    expect(body).not.toHaveProperty("props");
    expect(body).not.toHaveProperty("includeCryptoScreening");
  });
});

describe("mapTransactionResponse", () => {
  it("prefers uuid, then transaction_id", () => {
    expect(mapTransactionResponse({ uuid: "id-1", transaction_id: "id-2", status: "APPROVED" }).transactionId).toBe(
      "id-1"
    );
    expect(mapTransactionResponse({ transaction_id: "id-2", status: "APPROVED" }).transactionId).toBe("id-2");
  });

  it("extracts the travel-rule status from travel_rule, props or top level", () => {
    expect(mapTransactionResponse({ uuid: "x", status: "S", travel_rule: { status: "SENT" } }).travelRuleStatus).toBe(
      "SENT"
    );
    expect(
      mapTransactionResponse({ uuid: "x", status: "S", props: { travel_rule_status: "ACK" } }).travelRuleStatus
    ).toBe("ACK");
    expect(mapTransactionResponse({ uuid: "x", status: "S", travel_rule_status: "NEW" }).travelRuleStatus).toBe("NEW");
    expect(mapTransactionResponse({ uuid: "x", status: "S" }).travelRuleStatus).toBeUndefined();
  });

  it("maps a verification_session action_required block", () => {
    const result = mapTransactionResponse({
      uuid: "x",
      status: "AWAITING_USER",
      action_required: {
        type: "verification_session",
        url: "https://verify.didit.me/session/abc",
        session_id: "sess-1",
        session_token: "tok-1",
        status: "Not Started"
      }
    });

    expect(result.actionRequired).toEqual({
      type: "verification_session",
      url: "https://verify.didit.me/session/abc",
      sessionId: "sess-1",
      sessionToken: "tok-1",
      status: "Not Started"
    });
  });

  it("maps a wallet_ownership action_required block", () => {
    const result = mapTransactionResponse({
      uuid: "x",
      status: "AWAITING_USER",
      action_required: {
        type: "wallet_ownership",
        url: "https://verification.didit.me/wallet-ownership/tok",
        widget_session_id: "widget-1",
        expires_at: "2026-07-07T12:00:00Z"
      }
    });

    expect(result.actionRequired).toEqual({
      type: "wallet_ownership",
      url: "https://verification.didit.me/wallet-ownership/tok",
      widgetSessionId: "widget-1",
      expiresAt: "2026-07-07T12:00:00Z"
    });
  });

  it("ignores null or incomplete action_required blocks", () => {
    expect(mapTransactionResponse({ uuid: "x", status: "S", action_required: null }).actionRequired).toBeUndefined();
    expect(
      mapTransactionResponse({ uuid: "x", status: "S", action_required: { type: "wallet_ownership" } }).actionRequired
    ).toBeUndefined();
    expect(
      mapTransactionResponse({ uuid: "x", status: "S", action_required: { url: "https://x" } }).actionRequired
    ).toBeUndefined();
  });

  it("throws instead of fabricating an empty transactionId when uuid/transaction_id is missing", () => {
    expect(() => mapTransactionResponse({ status: "APPROVED" })).toThrow(DiditTransactionError);
    try {
      mapTransactionResponse({ status: "APPROVED" });
      throw new Error("expected mapTransactionResponse to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DiditTransactionError);
      expect((error as DiditTransactionError).type).toBe("network");
    }
  });

  it("throws instead of fabricating an empty status when status is missing", () => {
    // A missing status must not silently satisfy the poll's statusMoved early-exit
    // (an empty string differing from a real initialStatus would look like progress).
    expect(() => mapTransactionResponse({ uuid: "id-1" })).toThrow(DiditTransactionError);
  });

  it("does not throw when both uuid/transaction_id and status are present", () => {
    expect(() => mapTransactionResponse({ uuid: "id-1", status: "APPROVED" })).not.toThrow();
  });
});

describe("classifyTransactionError", () => {
  it("classifies 401/403 with 'expired' in detail or code as expired_token", () => {
    expect(classifyTransactionError(401, { detail: "Transaction token expired." }).type).toBe("expired_token");
    expect(classifyTransactionError(403, { detail: "Nope", code: "token_expired" }).type).toBe("expired_token");
  });

  it("classifies other 401/403 responses as invalid_token", () => {
    expect(classifyTransactionError(401, { detail: "Invalid token." }).type).toBe("invalid_token");
    expect(classifyTransactionError(403, null).type).toBe("invalid_token");
  });

  it("classifies 400/422 as validation and preserves field errors", () => {
    const body = { transaction_id: ["This field is required."] };
    const error = classifyTransactionError(400, body);
    expect(error.type).toBe("validation");
    expect(error.status).toBe(400);
    expect(error.fieldErrors).toEqual(body);
    expect(classifyTransactionError(422, {}).type).toBe("validation");
  });

  it("classifies anything else as network", () => {
    const error = classifyTransactionError(500, null);
    expect(error.type).toBe("network");
    expect(error.status).toBe(500);
    expect(error).toBeInstanceOf(DiditTransactionError);
  });
});

describe("pollTransactionAfterAction", () => {
  const jsonResponse = (payload: unknown): Response =>
    ({ ok: true, status: 200, json: async () => payload }) as Response;

  let fetchMock: jest.Mock<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.fn<typeof fetch>();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    // @ts-expect-error cleanup of the test-injected global
    delete globalThis.fetch;
  });

  it("stops early once the required action is cleared", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          uuid: "id-1",
          status: "AWAITING_USER",
          action_required: { type: "wallet_ownership", url: "https://verification.didit.me/wallet-ownership/t" }
        })
      )
      .mockResolvedValueOnce(jsonResponse({ uuid: "id-1", status: "APPROVED" }));

    const result = await pollTransactionAfterAction({
      baseUrl: "https://verification.didit.me",
      transactionToken: "tok",
      transactionId: "id-1",
      initialStatus: "AWAITING_USER",
      intervalMs: 1,
      maxAttempts: 10
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith("https://verification.didit.me/v1/transactions/id-1/", {
      method: "GET",
      headers: { "X-Transaction-Token": "tok" }
    });
    expect(result?.status).toBe("APPROVED");
    expect(result?.actionRequired).toBeUndefined();
  });

  it("stops early when the status moved even if an action block remains", async () => {
    const withAction = (status: string) =>
      jsonResponse({
        uuid: "id-1",
        status,
        action_required: { type: "verification_session", url: "https://verify.didit.me/s" }
      });
    fetchMock.mockResolvedValueOnce(withAction("AWAITING_USER")).mockResolvedValueOnce(withAction("IN_REVIEW"));

    const result = await pollTransactionAfterAction({
      baseUrl: "https://verification.didit.me",
      transactionToken: "tok",
      transactionId: "id-1",
      initialStatus: "AWAITING_USER",
      intervalMs: 1,
      maxAttempts: 10
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result?.status).toBe("IN_REVIEW");
  });

  it("returns the latest result after exhausting attempts without resolution", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        uuid: "id-1",
        status: "AWAITING_USER",
        action_required: { type: "wallet_ownership", url: "https://verification.didit.me/wallet-ownership/t" }
      })
    );

    const result = await pollTransactionAfterAction({
      baseUrl: "https://verification.didit.me",
      transactionToken: "tok",
      transactionId: "id-1",
      initialStatus: "AWAITING_USER",
      intervalMs: 1,
      maxAttempts: 3
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result?.status).toBe("AWAITING_USER");
  });

  it("returns null when every attempt fails", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));

    const result = await pollTransactionAfterAction({
      baseUrl: "https://verification.didit.me",
      transactionToken: "tok",
      transactionId: "id-1",
      intervalMs: 1,
      maxAttempts: 3
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toBeNull();
  });

  it("aborts immediately on a terminal invalid_token error instead of exhausting maxAttempts", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ detail: "Invalid token." }) } as Response);

    await expect(
      pollTransactionAfterAction({
        baseUrl: "https://verification.didit.me",
        transactionToken: "tok",
        transactionId: "id-1",
        intervalMs: 1,
        maxAttempts: 10
      })
    ).rejects.toMatchObject({ name: "DiditTransactionError", type: "invalid_token" });

    // A maxUses/expired token can never succeed on retry, and each GET consumes a
    // use server-side: retrying it would just burn the token's remaining uses.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts immediately on a terminal expired_token error instead of exhausting maxAttempts", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: "Transaction token expired." })
    } as Response);

    await expect(
      pollTransactionAfterAction({
        baseUrl: "https://verification.didit.me",
        transactionToken: "tok",
        transactionId: "id-1",
        intervalMs: 1,
        maxAttempts: 10
      })
    ).rejects.toMatchObject({ name: "DiditTransactionError", type: "expired_token" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps retrying on a non-terminal error type such as validation", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ detail: "Bad request." })
    } as Response);

    const result = await pollTransactionAfterAction({
      baseUrl: "https://verification.didit.me",
      transactionToken: "tok",
      transactionId: "id-1",
      intervalMs: 1,
      maxAttempts: 3
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toBeNull();
  });

  it("stops making requests once isAborted() reports true", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        uuid: "id-1",
        status: "AWAITING_USER",
        action_required: { type: "wallet_ownership", url: "https://verification.didit.me/wallet-ownership/t" }
      })
    );

    const result = await pollTransactionAfterAction({
      baseUrl: "https://verification.didit.me",
      transactionToken: "tok",
      transactionId: "id-1",
      initialStatus: "AWAITING_USER",
      intervalMs: 1,
      maxAttempts: 10,
      isAborted: () => fetchMock.mock.calls.length >= 2
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result?.status).toBe("AWAITING_USER");
  });
});

describe("submitTransactionRequest", () => {
  let fetchMock: jest.Mock<typeof fetch>;

  beforeEach(() => {
    resetDeviceFingerprintForTesting();
    fetchMock = jest.fn<typeof fetch>();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    // @ts-expect-error cleanup of the test-injected global
    delete globalThis.fetch;
    resetDeviceFingerprintForTesting();
  });

  it("posts the aliased body with the token and fingerprint contract", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ uuid: "id-9", status: "IN_REVIEW" })
    } as Response);

    const result = await submitTransactionRequest({
      baseUrl: "https://verification.didit.me",
      transactionToken: "tok-9",
      transaction: fullPayload
    });

    expect(result).toEqual({ transactionId: "id-9", status: "IN_REVIEW" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://verification.didit.me/v1/transactions/");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Transaction-Token"]).toBe("tok-9");
    // jsdom is a browser-like environment, so the fingerprint must be attached.
    expect(headers["X-Didit-FP-V2"]).toBe("1");
    expect(headers["X-Didit-PID"]).toMatch(/^[A-Za-z0-9_-]{20,32}$/);
    expect(headers["X-Didit-FP-Hash"]).toBeTruthy();

    const body = JSON.parse(init.body as string);
    expect(body.txnId).toBe("txn-123");
    expect(body.type).toBe("travelRule");
    expect(body.fingerprint_v2).toMatchObject({
      version: 2,
      schema: "didit-fp-v2",
      platform: "web",
      persistentId: headers["X-Didit-PID"],
      compositeHash: headers["X-Didit-FP-Hash"]
    });
  });

  it("throws a typed error mapped from the response status", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: "Transaction token expired." })
    } as Response);

    await expect(
      submitTransactionRequest({
        baseUrl: "https://verification.didit.me",
        transactionToken: "tok",
        transaction: fullPayload
      })
    ).rejects.toMatchObject({ name: "DiditTransactionError", type: "expired_token", status: 401 });
  });

  it("throws a network error when fetch itself fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(
      submitTransactionRequest({
        baseUrl: "https://verification.didit.me",
        transactionToken: "tok",
        transaction: fullPayload
      })
    ).rejects.toMatchObject({ name: "DiditTransactionError", type: "network" });
  });
});
