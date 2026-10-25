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
Sign-ins started in several tabs at once each wait on their own and complete
once, in any order; unfinished ones are forgotten after twenty minutes.

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
overwrite the new session or sign the person back in. A tab can see another
tab's `localStorage` write a moment late, so the tab holding the lock also
keeps the tokens in IndexedDB, and the next one reads them from there.

`getSession()` asks the API and caches the answer for 30 seconds; pass
`{ force: true }` before a decision that must see a revocation immediately.

### Where tokens are kept

`storage` is `"local"` (default: `localStorage`, shared by your tabs, with a
copy in IndexedDB for the tabs to agree on), `"session"` (this tab only),
`"memory"` (gone on reload) or your own store with `getItem`, `setItem` and
`removeItem` (they may return promises). Anything running on your pages can
read web storage and IndexedDB, so keep a strict Content Security Policy; Didit
limits the damage of a stolen refresh token by rotating it.

### Keeping the tokens on your server

To keep the tokens out of the page entirely, let your server exchange the
one-time code that ends every sign-in. The steps still run in the browser,
straight to Didit; only the code goes to your server, which posts it to
`token/`, keeps the tokens (for example in httpOnly cookies) and answers with
the body of `GET session/`:

```ts
const auth = createDiditAuth({
  publishableKey: "pk_live_...",
  redirectUri: "https://app.example.com/callback",
  async exchangeCode({ code, codeVerifier, redirectUri }) {
    const response = await fetch("/api/didit/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, codeVerifier, redirectUri })
    });
    return (await response.json()).session;
  }
});
```

This client then keeps no tokens, so use it for the sign-in steps only:
`getSession` and `getToken` answer `null`, and it reports no auth events.
`@didit-protocol/auth-nextjs` works this way.

## Your own screens (headless)

Every headless sign-in returns a result to act on:

| `status` | Next step |
| --- | --- |
| `"signed_in"` | Done: `result.session` (and `recoveryCodes` after a new authenticator). |
| `"code_sent"` | Ask for the six-digit code: `emailCode.verify` or `phone.verify`. |
| `"protection_required"` | Didit's bot and risk protection wants one more proof: `protection.verify` (emailed code) or `protection.passkey`. |
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

### Bot and risk protection

When your application's protection rules flag a sign-in (for example repeated
wrong passwords, a bot, a VPN or attack mode), the answer is
`"protection_required"` instead of a session. The person proves it is them
with a code Didit just emailed them or with one of their passkeys;
`result.methods` lists which they can use:

```ts
let result = await auth.password.signIn({ email, password });
if (result.status === "protection_required") {
  result = result.methods.includes("passkey")
    ? await auth.protection.passkey()
    : await auth.protection.verify({ code }); // the emailed code
}
if (result.status === "mfa_required") result = await auth.mfa.verify({ code: authenticatorCode });
```

The proof expires after `result.expiresIn` seconds and allows five tries. An
emailed code does not replace MFA, so `"mfa_required"` can follow it; a passkey
counts as both.

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

### Step-up before sensitive actions

Your application's step-up rules, set in the Didit console, can ask the person
for a liveness check, a selfie or an ID before a payout, a bank account change
or a contact change. Ask Didit before the action:

```ts
const check = await auth.stepUp({ action: "payout", amount: "900.00", currency: "USD" });
if (check.approved) await payOut(); // no rule asked for a check

// Otherwise the check opened. On redirectUri, where the person comes back:
const outcome = await auth.handleStepUpCallback();
if (outcome.approved) await payOut();
```

`action` is `"payout"`, `"bank"` or `"contact"`. Both calls resolve with
`{ id, status, approved, rule, method }`: `status` is `"not_required"`,
`"pending"`, `"approved"`, `"review"`, `"declined"` or `"expired"`. The person
comes back to `redirectUri` (it must be registered exactly) with `?step_up=<id>`
added; `handleStepUpCallback` reads the outcome from Didit, never from the
address, and removes it from the address bar. Before acting, your backend reads
the step-up again with the person's access token (`GET step-up/<id>/` on your
application's origin): what runs in a browser can be changed.

### Signing in again

Some actions need a session at most five minutes old (adding a passkey), or
one created with a passkey. They reject with `reauthentication_required` or
`passkey_required`; sign the person in again and retry:

```ts
await auth.reauthenticate();                       // hosted page; finish with handleRedirectCallback
await auth.reauthenticate({ method: "passkey" });  // on the Didit sign-in domain
```

A reauthentication completed by someone else rejects with
`step_up_user_mismatch` and keeps the original session. A completed one ends
the session it replaces at Didit too, renewing that session's access token
first when it expired while the person was on the hosted page.

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
its OpenID discovery document), issued by your application (`iss`, the origin
your publishable key names) and not expired (5 seconds of clock tolerance).
Every application has its own issuer and signing keys and names itself as the
audience of all its tokens; pass `audience` (your application id) to check
`aud` as well. The
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

Your key is in the Didit console under Authentication > Developers. It names
your application's own Didit host, where its hosted pages, its API and its
token issuer live: `pk_live_` (Live) or `pk_test_` (Sandbox) followed by the
base64url encoding, without padding, of that origin. For example

```text
pk_live_aHR0cHM6Ly9leGFtcGxlLWFwcC1iMjMwMjc2OTdjN2YzNGI0ZjFmMGJmYmIwZDNmZmZlNC5hdXRoLmRpZGl0Lm1l
```

names `https://example-app-b23027697c7f34b4f1f0bfbb0d3fffe4.auth.didit.me`.
Once you activate a custom domain the key names it instead, for example
`https://auth.example.com`: copy the new key, since your tokens' issuer changes
with it and people signed in on your pages sign in again. The key is public:
ship it in your front end. Live keys use HTTPS; Sandbox keys may also name a
local HTTP host (`localhost` or a name under it). Anything else, including an
address with a path, is refused with `invalid_publishable_key`.

On a server, `parsePublishableKey(key)` from `@didit-protocol/auth/server`
returns `{ mode, origin }`, or throws that error.

## Errors

Every method rejects with a `DiditAuthError` whose `code` you can branch on:
`invalid_credentials`, `invalid_grant` (wrong, expired or used code),
`method_unavailable`, `password_policy` (see `fields`), `rate_limited` (see
`retryAfter`), `mfa_required`, `reauthentication_required`,
`passkey_required`, `passkey_unavailable`, `passkey_cancelled`,
`attempt_blocked` (protection refused the sign-in),
`protection_factor_unavailable`, `invalid_redirect_uri`, `not_signed_in`,
`no_pending_attempt`, `invalid_state`, `step_up_user_mismatch`,
`invalid_publishable_key`, `invalid_token`, `token_expired`,
`jwks_unavailable` and `network_error`. Codes sent by the API are passed
through unchanged.

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
