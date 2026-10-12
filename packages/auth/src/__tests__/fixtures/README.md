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

Phone codes are delivered through Didit's verification service, which was not
running, so `phone.json` records the API's `delivery_unavailable` answer.
Passkey ceremonies need a browser authenticator: `passkey-begin.json` stops
after the API's options, and `e2e/live.spec.mjs` covers the full ceremony.
