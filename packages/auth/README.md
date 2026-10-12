# @didit-protocol/auth

Sign your users up and in with Didit Authentication: the hosted sign-in page or
your own screens (password, emailed codes, phone, passkeys, MFA), sessions that
refresh themselves, sign-out, step-up for sensitive actions and your users' AI
agents. A `/server` entry verifies access tokens on your backend.

It has no UI and one dependency, `@didit-protocol/signals`, which attaches the
device signals that tie each sign-in to the device that made it. The browser
entry is about 6 KB minified and gzipped; the server entry about 2 KB.

```bash
npm install @didit-protocol/auth
```

## Quick start: the hosted page

```ts
import { createDiditAuth } from "@didit-protocol/auth";

export const auth = createDiditAuth({
  publishableKey: "pk_live_...",
  redirectUri: "https://app.example.com/callback"
});

// Sign-in button
await auth.signIn({ returnTo: "/dashboard" });

// On https://app.example.com/callback
const { session, returnTo } = await auth.handleRedirectCallback();
```

The hosted page shows every method turned on for your application (password,
email code, magic link, passkey, phone, Didit ID Wallet, Google, Microsoft,
Apple, GitHub and enterprise SSO) and handles MFA. The sign-in is bound to
this browser with PKCE (S256) and a random `state`; `handleRedirectCallback`
refuses a redirect it did not start, exchanges the one-time code and removes it
from the address bar. A magic link completes in whichever tab opens it.

Register `redirectUri` in the Didit console, exactly. It defaults to the
current page without its query string. Create one client per application and
reuse it: headless steps in progress live in that client.

## Sessions

```ts
const session = await auth.getSession(); // null when signed out
session?.userId;      // the person's Didit identity id
session?.vendorData;  // ties them to their verifications and transactions
session?.email;
session?.methods;     // ["password"], ["passkey"], ...

const token = await auth.getToken(); // send it to your backend as a Bearer token

const stop = auth.onAuthStateChange((event, session) => {
  // "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED", also from your other tabs
});

await auth.signOut(); // ends the session at Didit too
```

Access tokens last five minutes. `getToken()` refreshes them shortly before
they expire. Refresh tokens rotate, and Didit revokes the whole session when a
used one is presented again, so the SDK refreshes once for all the tabs of
your origin (Web Locks) and the other tabs take the new tokens. A sign-in or
sign-out waits for a refresh another tab has in flight, so that refresh cannot
overwrite the new session or sign the person back in.

`getSession()` asks the API and caches the answer for 30 seconds; pass
`{ force: true }` before a decision that must see a revocation immediately.

### Where tokens are kept

`storage` is `"local"` (default: `localStorage`, shared by your tabs),
`"session"` (this tab only), `"memory"` (gone on reload) or your own store with
`getItem`, `setItem` and `removeItem` (they may return promises). Anything
running on your pages can read web storage, so keep a strict Content Security
Policy; Didit limits the damage of a stolen refresh token by rotating it.

## Your own screens (headless)

Every headless sign-in returns a result to act on:

| `status` | Next step |
| --- | --- |
| `"signed_in"` | Done: `result.session` (and `recoveryCodes` after a new authenticator). |
| `"code_sent"` | Ask for the six-digit code: `emailCode.verify` or `phone.verify`. |
| `"mfa_required"` | Ask for an authenticator or recovery code: `mfa.verify`. |
| `"mfa_enrollment_required"` | Show `result.uri` as a QR code, then `mfa.setup` with the first code. |

```ts
// Password
let result = await auth.password.signIn({ email, password });
if (result.status === "mfa_required") result = await auth.mfa.verify({ code });

// Sign-up: proves the address with an emailed code
await auth.password.signUp({ email, password });
await auth.emailCode.verify({ code });

// Passwordless email code, and phone (SMS or WhatsApp)
await auth.emailCode.start({ email });
await auth.emailCode.verify({ code });
await auth.phone.start({ phone: "+14155550123", channel: "sms" });
await auth.phone.verify({ code });

// Forgot password: emails a link to the hosted reset page
await auth.password.requestReset({ email });

// Magic links and social providers run on the hosted page
await auth.magicLink.signIn();
await auth.social.signIn();
```

`social.signIn()` opens the hosted page with every provider the application
enabled; it cannot open on one chosen provider yet, so a "Continue with Google"
button leads to the full list of sign-in methods.

### MFA for a signed-in person

```ts
const { uri } = await auth.mfa.enroll(); // show as a QR code
const { recoveryCodes } = await auth.mfa.confirm({ code });
```

### Passkeys

```ts
await auth.passkeys.register(); // adds one to the signed-in person
await auth.passkeys.signIn();
```

Passkeys belong to your application's Didit sign-in domain, so the browser
only runs them on that domain. Elsewhere these methods reject with
`passkey_unavailable`: use the hosted page, which offers passkeys.

### Step-up

Some actions need a session at most five minutes old, or one created with a
passkey. They reject with `reauthentication_required` or `passkey_required`;
sign the person in again and retry:

```ts
await auth.stepUp();                       // hosted page; finish with handleRedirectCallback
await auth.stepUp({ method: "passkey" });  // on the Didit sign-in domain
```

A step-up completed by someone else rejects with `step_up_user_mismatch` and
keeps the original session. A completed one ends the session it replaces at
Didit too, renewing that session's access token first when it expired while
the person was on the hosted page.

### AI agents

```ts
const grants = await auth.agents.list();
await auth.agents.revoke(grants[0].id);

// Your consent page, opened with the agent's request challenge
const result = await auth.agents.consent({ challenge, decision: "approve" });
if (result.status === "approved") location.assign(result.redirectTo);
```

## Device signals

Auth requests carry the device signals of `@didit-protocol/signals`: a
persistent device id, a fingerprint hash, the webview kind and a bot score.
Browsers only send extra headers to another origin when that origin allows
them, so by default (`deviceSignals: "auto"`) they are sent when your page and
the Didit API share an origin. Set `"always"` once your sign-in domain allows
them across origins, or `"off"` to never send them.

## Server: verify access tokens

```ts
import { verifyToken } from "@didit-protocol/auth/server";

const claims = await verifyToken(bearerToken, { publishableKey: process.env.DIDIT_PUBLISHABLE_KEY });
claims.sub;          // the person
claims.vendor_data;  // your id for them
claims.act;          // set when an AI agent acts for them (null otherwise): check claims.act.scopes
```

`verifyToken` accepts only ES256 access tokens (header `typ: at+jwt`, so an ID
token is refused) signed by one of the issuer's published keys (found through
its OpenID discovery document), issued by your application (`iss`), for your
application (`aud`) and not expired (5 seconds of clock tolerance). The
discovery document and the keys are cached for ten minutes; a token signed with
a key the server has not seen yet reloads the keys, at most once every 30
seconds. Concurrent requests share one load, and while the issuer is
unreachable the last good keys keep working and it is asked again at most once
every 5 seconds. Pass `issuer`, `audience` or `jwksUri` to override what the
publishable key implies. It runs on Node.js 20+ and edge runtimes with
WebCrypto.

Access tokens stay valid until they expire. Before an action that must see a
sign-out or a block at once, also check the session with the API.

## Publishable keys

A publishable key names your application and where its Didit API lives:
`pk_live_` or `pk_test_` followed by the base64url encoding of the
application's API address (ending in its application id). It is public:
ship it in your front end. Live keys must use HTTPS; test keys may point at a
local `http://localhost` API.

## Errors

Every method rejects with a `DiditAuthError` whose `code` you can branch on:
`invalid_credentials`, `invalid_grant` (wrong, expired or used code),
`method_unavailable`, `password_policy` (see `fields`), `rate_limited` (see
`retryAfter`), `mfa_required`, `reauthentication_required`,
`passkey_required`, `passkey_unavailable`, `passkey_cancelled`,
`not_signed_in`, `no_pending_attempt`, `invalid_state`,
`step_up_user_mismatch`, `invalid_publishable_key`, `invalid_token`,
`token_expired`, `jwks_unavailable` and `network_error`. Codes sent by the API
are passed through unchanged.

## Development

```bash
npm test             # unit tests: recorded API exchanges, real ES256 keys
npm run typecheck
npm run build
npm run size         # fails above 10 KB (browser) or 4 KB (server) min+gz
npm run test:e2e     # Chromium, Firefox and WebKit
```

The unit and browser tests replay request and response pairs recorded against
a local Didit auth service (`src/__tests__/fixtures`). `e2e/live.spec.mjs` runs
the same flows against a running service.
