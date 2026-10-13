# Recorded API exchanges

Each file is one scenario: the requests this SDK sent to a local Didit auth
service, with the service's real responses, in order. The service ran on
`http://127.0.0.1:8765` against a disposable database with a sandbox
application, example.com identities and a local mailbox instead of an email
provider. Tokens, codes and ids in these files are from that database only.

The SDK drew its random values from `helpers/seeded-random.ts` seeded with the
scenario name, so a test that seeds the same way sends byte-identical PKCE
verifiers, challenges and states, and `helpers/replay.ts` checks every request
against the recording before answering it. Other keys hold the recording's
inputs and outcomes, such as the emailed code (`code`), a deliberately wrong
one (`wrongCode`) or the redirect the hosted page answered (`callbackUrl`).

Two-tab scenarios (`redirect-two-tabs`, `redirect-two-tabs-reversed`) were
recorded with two tabs of one browser: the second tab draws from the same seed
48 bytes in, after the first tab's verifier and state. `signIns` lists each
tab's hosted sign-in, the person who completed it and the resulting session,
`completionOrder` the order the tabs completed in. In `redirect-code-reused`
a second tab exchanges the same code after the first tab completed, and the
service refuses it.

Phone codes are delivered through Didit's verification service, which was not
running, so `phone.json` records the API's `delivery_unavailable` answer.
Passkey ceremonies need a browser authenticator: `passkey-begin.json` stops
after the API's options, and `e2e/live.spec.mjs` covers the full ceremony.

## Each application's own host

The service now serves every application on its own host (`<slug>.auth.didit.me`,
`<slug>.sandbox.auth.didit.me` or its custom domain), with the runtime API at
the root, and its publishable key names that origin. The recordings above were
made at the shared mount `apiBase` names; the service serves the same routes at
the root of each application's host, so `helpers/replay.ts` replays them at the
origin of the local Sandbox application below. Their requests and answers are
unchanged.

`publishable-keys.json` holds keys the service minted with the serializer the
console API uses (`ConfigurationSerializer.get_publishable_key`): a Live and a
Sandbox application on Didit's zone (`https://auth.didit.me`), an application
with an active custom domain, and the local Sandbox application on the zone
`http://auth.localhost:8766`. For a Live application on that HTTP zone the
service issues no key (`null`).

The newer files name that `origin` and its `publishableKey` and were recorded
against the service on that zone, with the built SDK in Chromium:

- `step-up-check`: `POST step-up/` with no rule for the payout, a return
  address the application did not register, and the contact-change rule
  (liveness); `GET step-up/{id}/` read once from an address claiming approval
  before the check ran (`forgedReturn`), then after the person passed the
  check on the hosted card and came back (`returnUrl`). Verification was the
  service's own stand-in (`tests/authentication/verification_service.py`),
  answering with verification's recorded decisions.
- `protection-email-code` and `protection-passkey`: the application's
  protection challenges brute force, so after five wrong passwords the right
  one answers `protection_required`. The first person answers with the
  emailed code (after a wrong one), the second, who added a passkey in an
  earlier unrecorded session, with that passkey: `protection-passkey` ran on
  the application's own host, where the passkey works, with device signals
  off.
- `issuer`: the application's discovery document and signing keys, as
  `verifyToken` fetches them.
