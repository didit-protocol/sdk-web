# Changelog

All notable changes to `@didit-protocol/auth` are documented in this file.

## [Unreleased]

### Added

- `createDiditAuth({ publishableKey })`: hosted sign-in with PKCE (`signIn`,
  `handleRedirectCallback`), `getSession`, `getToken`, `onAuthStateChange` and
  `signOut`, with refreshes serialized across tabs.
- Headless methods: `password`, `emailCode`, `phone`, `passkeys`, `mfa`,
  `magicLink`, `social`, `stepUp` and `agents`. `magicLink` and `social` open
  the hosted page with every enabled method.
- Device signals from `@didit-protocol/signals` on auth requests.
- `@didit-protocol/auth/server`: `verifyToken` for ES256 access tokens, with
  issuer discovery and signing keys cached, loaded once for concurrent
  requests and retried at most every 5 seconds while the issuer is down.
