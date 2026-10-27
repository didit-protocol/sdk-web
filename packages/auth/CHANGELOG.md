# Changelog

All notable changes to `@didit-protocol/auth` are documented in this file.

## [0.1.0] - 2026-10-27

First release of the headless Didit Authentication client for the browser, with
server-side token verification.

### Added

- `createDiditAuth({ publishableKey })`: hosted sign-in with PKCE (`signIn`,
  `handleRedirectCallback`), `getSession`, `getToken`, `onAuthStateChange` and
  `signOut`. Refreshes, sign-ins and sign-outs take turns across tabs, and
  other tabs' changes are reported from the tokens stored now.
- Publishable keys as the Didit console issues them: the base64url encoding
  of the application's own origin (its Didit host or active custom domain),
  which is also where its API, hosted pages and token issuer live.
- Headless methods: `password`, `emailCode`, `phone`, `passkeys`, `mfa`,
  `magicLink`, `social`, `protection` and `agents`. `magicLink` and `social`
  open the hosted page with every enabled method. A sign-in that bot and risk
  protection challenges answers `"protection_required"`, finished with an
  emailed code (`protection.verify`) or a passkey (`protection.passkey`).
- `stepUp({ action })` asks Didit's step-up rules before a payout, bank or
  contact change and opens the identity check they ask for;
  `handleStepUpCallback` reads Didit's record of it. `reauthenticate()` signs
  the current person in again.
- `exchangeCode` option: the app's server exchanges the one-time code that ends
  a sign-in, so the tokens never reach the page; the client then keeps none.
- Device signals from `@didit-protocol/signals` on auth requests.
- `@didit-protocol/auth/server`: `verifyToken` for ES256 access tokens (header
  `typ: at+jwt`; ID tokens are refused) of the issuer the publishable key
  names, checking `aud` when `audience` is given, with issuer discovery and
  signing keys cached, loaded once for concurrent requests and retried at most
  every 5 seconds while the issuer is down. `parsePublishableKey` reads the
  application's origin from its key.
