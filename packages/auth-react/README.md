# @didit-protocol/auth-react

React components and hooks for Didit Authentication: sign people up and in on
your Didit sign-in page, read the session anywhere in your app, and let people
manage the AI agents they allowed to act for them.

Using Next.js? Install [`@didit-protocol/auth-nextjs`](../auth-nextjs) instead:
it keeps the session in httpOnly cookies and renders signed-in pages on the
server, with the same components.

## Install

```bash
npm install @didit-protocol/auth-react @didit-protocol/auth
```

`@didit-protocol/auth` is the headless browser client that `<DiditAuth>` runs
on (hosted sign-in with PKCE, sessions, tokens).

## Quick start

```tsx
import { DiditAuth, SignIn } from "@didit-protocol/auth-react";

export function App() {
  return (
    <DiditAuth publishableKey="pk_test_...">
      <SignIn />
    </DiditAuth>
  );
}
```

Your publishable key is in the Didit console under Authentication > Developers.
Use your Sandbox application's key while you build.

## Components

| Component | What it does |
| --- | --- |
| `<DiditAuth publishableKey>` | Provides the session to everything below it. Optional `appearance`, `locale`, `nonce`, `frontendApi`, `redirectUri`. |
| `<SignIn />`, `<SignUp />` | Open your Didit sign-in page. Someone already signed in goes straight on to `redirectUrl` (default: the page's `redirect_url`, then `/`). `fallback` renders meanwhile. |
| `<SignedIn>`, `<SignedOut>` | Render their children only when someone is, or is not, signed in. Neither renders while the session is still loading. |
| `<UserButton />` | The person's avatar with a menu to sign out. `afterSignOutUrl` defaults to `/`. |
| `<ConnectedAgents />` | The AI agents the person allowed to act for them, each with a Revoke button. Revoking ends the agent's access everywhere at once. `applicationName` names your app in the subtitle; `scopeLabels` describes each permission in words, keyed by the scope names you configured. |

## Hooks

```tsx
const { isLoaded, isSignedIn, userId, session, signIn, signUp, signOut, stepUp, getToken } = useAuth();
const { user } = useUser(); // { id, email, emailVerified, phone, vendorData, verifiedIdentity, organizations }
```

- `getToken()` returns a short-lived access token for calling your own API.
- `stepUp()` asks the person to sign in again before a sensitive action and
  brings them back to the current page.
- `user.vendorData` is your own id for the person, shared with Didit identity
  verification and transaction monitoring.

## Appearance

Components follow the device's light or dark setting. Override it, and the
accent and font, with `appearance`:

```tsx
<DiditAuth publishableKey="pk_test_..." appearance={{ theme: "dark", brandColor: "#6B3CF6", fontFamily: "Inter" }}>
```

The same can be set in CSS with `--didit-auth-brand`, `--didit-auth-brand-dark`
and `--didit-auth-font`. Components use the surrounding page's font by default.
`nonce` adds a Content Security Policy nonce to the one `<style>` element the
provider renders.

## Languages

English, Spanish, French, German and Japanese are built in. `locale` takes any
BCP 47 tag (`es-MX` uses Spanish); the default is the browser language, then
English.

## Your own client

`@didit-protocol/auth-react/provider` exports everything except the browser
binding: `DiditAuthProvider` takes any object implementing `AuthClient`. This
is how the Next.js package runs the same components on its server-side session.
