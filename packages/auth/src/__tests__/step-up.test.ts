import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { createDiditAuth } from "../client";
import type { DiditStepUpResult } from "../types";
import { loadFixture, replay, runtimeOf } from "./helpers/replay";

const PASSWORD = "Correct-horse-battery-91";
const PAGE = "/e2e/fixtures/app.html";

function setup() {
  const fixture = loadFixture("step-up-check");
  const api = replay(fixture);
  const navigate = jest.fn<(url: string) => void>();
  const auth = createDiditAuth({ publishableKey: runtimeOf(fixture).publishableKey, fetch: api.fetch, navigate });
  return { fixture, api, auth, navigate };
}

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, "", PAGE);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("step-up", () => {
  it("asks Didit before each action, opens the check a rule asks for, and reads Didit's record on return", async () => {
    const { fixture, api, auth, navigate } = setup();
    const contact = fixture.contact as DiditStepUpResult;

    await auth.password.signIn({ email: "person@example.com", password: PASSWORD });

    // No rule applies to this payout: the action goes ahead.
    await expect(auth.stepUp({ action: "payout", amount: "900.00", currency: "USD" })).resolves.toEqual({
      id: null,
      status: "not_required",
      approved: true,
      rule: null,
      method: null
    });
    expect(navigate).not.toHaveBeenCalled();

    // The person can only come back to a registered address.
    await expect(auth.stepUp({ action: "contact", redirectUri: "https://elsewhere.example.com/" })).rejects.toMatchObject({
      code: "invalid_redirect_uri",
      status: 400,
      fields: { return_to: ["invalid_redirect_uri"] }
    });

    // The application's contact-change rule asks for a liveness check on the hosted page.
    await expect(auth.stepUp({ action: "contact" })).resolves.toEqual({
      id: contact.id,
      status: "pending",
      approved: false,
      rule: "contact",
      method: "liveness"
    });
    expect(navigate.mock.calls).toEqual([[fixture.verificationUrl]]);

    // An address claiming approval before the check ran: Didit's record still says pending.
    const forged = new URL(fixture.forgedReturn as string);
    expect(forged.searchParams.get("status")).toBe("approved");
    await expect(auth.handleStepUpCallback(forged.href)).resolves.toMatchObject({ id: contact.id, status: "pending", approved: false });

    // Back from the check: the outcome is read from Didit, and the step-up leaves the address bar.
    const back = new URL(fixture.returnUrl as string);
    history.replaceState(null, "", back.pathname + back.search);
    await expect(auth.handleStepUpCallback()).resolves.toEqual({
      id: contact.id,
      status: "approved",
      approved: true,
      rule: "contact",
      method: "liveness"
    });
    expect(location.href).toBe(`${location.origin}${PAGE}`);

    // Every call carried the person's access token.
    const token = (fixture.exchanges[2].response.body as { access_token: string }).access_token;
    for (const exchange of fixture.exchanges.slice(4)) expect(exchange.request.authorization).toBe(`Bearer ${token}`);
    api.verify();
  });

  it("needs a signed-in person", async () => {
    const { api, auth } = setup();

    await expect(auth.stepUp({ action: "contact" })).rejects.toMatchObject({ code: "not_signed_in" });
    await expect(auth.handleStepUpCallback(`http://localhost:4174${PAGE}?step_up=${crypto.randomUUID()}`)).rejects.toMatchObject({
      code: "not_signed_in"
    });
    api.verify(0);
  });

  it("refuses an address that does not come back from a step-up, without asking Didit", async () => {
    const { api, auth } = setup();

    for (const address of [`http://localhost:4174${PAGE}`, `http://localhost:4174${PAGE}?step_up=../session`]) {
      await expect(auth.handleStepUpCallback(address)).rejects.toMatchObject({ code: "invalid_request" });
    }
    api.verify(0);
  });
});
