import { resolveConfig } from "../server/config";
import { cachedSession, primeSession, refreshOnce, resetCaches } from "../server/session-cache";
import { toSession } from "../server/runtime-api";
import { ENV, recorded, replay } from "./replay";

const config = resolveConfig(ENV);
beforeEach(resetCaches);
afterEach(() => jest.restoreAllMocks());

it("does not reuse a cached identity across application issuers", async () => {
  const other = { ...config, frontendApi: `${config.frontendApi}-other` };

  primeSession(config, "same-token", toSession(recorded.session.body));
  global.fetch = jest.fn(async () => new Response(JSON.stringify(recorded.sessionInvalid.body), { status: 401 }));
  await expect(cachedSession(other, "same-token")).resolves.toBeNull();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it("honors no-cache even if another caller primed the session", async () => {
  primeSession(config, "token", toSession(recorded.session.body));
  const { calls } = replay({ method: "GET", path: "session/", response: recorded.sessionInvalid });

  await expect(cachedSession({ ...config, sessionCacheMs: 0 }, "token")).resolves.toBeNull();
  expect(calls).toHaveLength(1);
});

it("never caches past the session's absolute expiry", async () => {
  primeSession(config, "token", { ...toSession(recorded.session.body), expiresAt: new Date(Date.now() - 1).toISOString() });
  const { calls } = replay({ method: "GET", path: "session/", response: recorded.sessionInvalid });

  await expect(cachedSession(config, "token")).resolves.toBeNull();
  expect(calls).toHaveLength(1);
});

it("refreshes independently for distinct applications", async () => {
  const other = { ...config, frontendApi: `${config.frontendApi}-other` };

  global.fetch = jest.fn(async () => new Response(JSON.stringify(recorded.tokenRotated.body), { status: 200 }));
  await refreshOnce(config, "same-refresh");
  await refreshOnce(other, "same-refresh");
  expect(global.fetch).toHaveBeenCalledTimes(2);
});
