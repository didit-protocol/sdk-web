import { expect, it, jest } from "@jest/globals";
import { createDiditAuth } from "../client";
import { loadFixture, replay, runtimeOf } from "./helpers/replay";

it("shows what the old stepUp sends", async () => {
  const fixture = loadFixture("step-up-check");
  const api = replay(fixture);
  const navigate = jest.fn();
  const auth = createDiditAuth({ publishableKey: runtimeOf(fixture).publishableKey, fetch: api.fetch, navigate: navigate as never });
  await auth.password.signIn({ email: "person@example.com", password: "Correct-horse-battery-91" });
  const outcome = await (auth.stepUp as any)({ action: "payout", amount: "900.00", currency: "USD" }).then(String, (e: Error) => `rejected: ${e.message}`);
  let report = "";
  try { api.verify(); } catch (e) { report = (e as Error).message; }
  console.log(`stepUp -> ${outcome}\n${report}`);
  expect(true).toBe(true);
});
