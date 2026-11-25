import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { setCollectorLoaderForTesting } from "../../packages/signals/src/collector";
import { resetDeviceFingerprintForTesting } from "../../packages/signals/src/fingerprint";
import { installWebCryptoForTests } from "../../packages/signals/src/device/__tests__/_test_setup";
import { FAKE_EVIDENCE, fakeCollector } from "../../packages/signals/src/__tests__/fake-collector";
import { submitTransactionRequest } from "../transactions";

installWebCryptoForTests();

const transaction = {
  txnId: "txn-1",
  txnDate: "2026-07-07T10:00:00Z",
  zoneId: "Europe/Madrid",
  category: "payment",
  details: { direction: "out", amount: "1", currency: "EUR", currencyType: "fiat" },
  subject: { type: "individual", externalUserId: "user-1" }
} as unknown as Parameters<typeof submitTransactionRequest>[0]["transaction"];

describe("a transaction carries the collector's evidence and no score", () => {
  let fetchMock: jest.Mock<typeof fetch>;

  beforeEach(() => {
    localStorage.clear();
    resetDeviceFingerprintForTesting();
    fetchMock = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ uuid: "id-1", status: "APPROVED" })
    } as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    setCollectorLoaderForTesting(null);
    resetDeviceFingerprintForTesting();
    Reflect.deleteProperty(globalThis, "fetch");
  });

  async function send(): Promise<{ headers: Record<string, string>; body: Record<string, unknown> }> {
    await submitTransactionRequest({ baseUrl: "https://verification.didit.me", transactionToken: "tok", transaction });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return { headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) };
  }

  it("posts fingerprint_v2.evidence as text, no bot member and no score header", async () => {
    const fake = fakeCollector();
    setCollectorLoaderForTesting(async () => fake.collector);

    const { headers, body } = await send();

    expect((body.fingerprint_v2 as Record<string, unknown>).evidence).toBe(FAKE_EVIDENCE);
    // The collector is asked for its evidence only: no full fingerprint is collected by default.
    expect(fake.collect).not.toHaveBeenCalled();
    expect(body.fingerprint_v2).not.toHaveProperty("bot");
    expect(headers).not.toHaveProperty("X-Didit-FP-Bot-Score");
    expect(headers["X-Didit-FP-V2"]).toBe("1");
  });

  it("still posts, with the lite payload, when the collector fails", async () => {
    setCollectorLoaderForTesting(() => Promise.reject(new Error("blocked")));

    const { headers, body } = await send();

    expect(body.fingerprint_v2).not.toHaveProperty("evidence");
    expect(headers["X-Didit-PID"]).toMatch(/^[A-Za-z0-9_-]{20,32}$/);
  });
});
