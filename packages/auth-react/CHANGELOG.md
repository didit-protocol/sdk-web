# Changelog

All notable changes to `@didit-protocol/auth-react` are documented in this file.

## [0.2.0] - 2026-11-12

### Fixed

- Components no longer wait forever when the session cannot be loaded: `useAuth()`, `<SignedIn>` and
  `<SignedOut>` read as signed out, so a protected screen shows its guest state.
- Two `<DiditAuth>` providers on one page stay in agreement: a sign-in or sign-out in one is followed by the other.
- A token refresh that arrives before the first session read no longer signs the person out.
- The browser language is read after mount, so server rendering and hydration agree.

### Changed

- Released with `@didit-protocol/auth` 0.2.0, which sends device signals with sign-in calls by default.

## [0.1.0] - 2026-10-27

First release of the React components and hooks for Didit Authentication.

### Added
- `<DiditAuth publishableKey>`, `<SignIn />`, `<SignUp />`, `<SignedIn>`, `<SignedOut>`, `<UserButton />` and `<ConnectedAgents />`, with `useAuth()` and `useUser()`.
- Light, dark and device themes; English, Spanish, French, German and Japanese.
- `@didit-protocol/auth-react/provider`, the components on any `AuthClient`.
- `useAuth().stepUp({ action })` and `handleStepUpCallback()` run your application's step-up rules; `reauthenticate()` signs the person in again.
- Headless sign-in steps on `useAuth()` (`password`, `emailCode`, `phone`, `protection`, `mfa`), including the `protection_required` answer of bot and risk protection.
