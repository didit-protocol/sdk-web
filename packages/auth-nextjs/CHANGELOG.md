# Changelog

All notable changes to `@didit-protocol/auth-nextjs` are documented in this file.

## [0.1.0] - 2026-10-27

First release of Didit Authentication for the Next.js App Router, with
session cookies the browser cannot read.

### Added
- `diditAuthProxy()` for `proxy.ts` (Next.js 16) or `middleware.ts`: hosted sign-in with PKCE, the callback, sign-out, httpOnly session cookies, refresh and protected paths.
- `auth()` and `auth.protect()` for server components, route handlers and server actions.
- `<DiditAuth>` that renders signed in or out from the first server render, and the `@didit-protocol/auth-react` components and hooks.
- The Frontend API comes from `DIDIT_PUBLISHABLE_KEY`, the application origin the key names; there is no `DIDIT_FRONTEND_API`.
- `useAuth().stepUp({ action })` and `handleStepUpCallback()` through `POST /auth/step-up` and `GET /auth/step-up/{id}`, and `auth().getStepUp(id)` on the server. `/auth/reauthenticate` signs the person in again.
- Headless sign-in steps on `useAuth()`, including `protection_required`: they run in the browser and `POST /auth/exchange` completes them, so the tokens stay in httpOnly cookies.
