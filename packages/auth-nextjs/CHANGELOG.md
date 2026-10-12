# Changelog

## [0.1.0] - Unreleased

### Added
- `diditAuthProxy()` for `proxy.ts` (Next.js 16) or `middleware.ts`: hosted sign-in with PKCE, the callback, sign-out, httpOnly session cookies, refresh and protected paths.
- `auth()` and `auth.protect()` for server components, route handlers and server actions.
- `<DiditAuth>` that renders signed in or out from the first server render, and the `@didit-protocol/auth-react` components and hooks.
