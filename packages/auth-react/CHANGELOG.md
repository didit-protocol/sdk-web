# Changelog

## [0.1.0] - Unreleased

### Added
- `<DiditAuth publishableKey>`, `<SignIn />`, `<SignUp />`, `<SignedIn>`, `<SignedOut>`, `<UserButton />` and `<ConnectedAgents />`, with `useAuth()` and `useUser()`.
- Light, dark and device themes; English, Spanish, French, German and Japanese.
- `@didit-protocol/auth-react/provider`, the components on any `AuthClient`.
- `useAuth().stepUp({ action })` and `handleStepUpCallback()` run your application's step-up rules; `reauthenticate()` signs the person in again.
- Headless sign-in steps on `useAuth()` (`password`, `emailCode`, `phone`, `protection`, `mfa`), including the `protection_required` answer of bot and risk protection.
