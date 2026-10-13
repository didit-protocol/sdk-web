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
| `<DiditAuth publishableKey>` | Provides the session to everything below it. Optional `appearance`, `locale`, `nonce`, `redirectUri`. |
| `<SignIn />`, `<SignUp />` | Open your Didit sign-in page. Someone already signed in goes straight on to `redirectUrl` (default: the page's `redirect_url`, then `/`). `fallback` renders meanwhile. |
| `<SignedIn>`, `<SignedOut>` | Render their children only when someone is, or is not, signed in. Neither renders while the session is still loading. |
| `<UserButton />` | The person's avatar with a menu to sign out. `afterSignOutUrl` defaults to `/`. |
| `<ConnectedAgents />` | The AI agents the person allowed to act for them, each with a Revoke button. Revoking ends the agent's access everywhere at once. `applicationName` names your app in the subtitle; `scopeLabels` describes each permission in words, keyed by the scope names you configured. |

The hosted runtime currently opens its method chooser for both `SignIn` and
`SignUp`; Create account on that page starts registration. Neither component
sends an unsupported screen parameter. The publishable key follows the
headless peer's format and must resolve to your application's runtime API.

`ConnectedAgents` can also take `agentDetails`, keyed by agent id, with
localized `publisherLabel` and `activityLabel` from your application's own
catalog and audit log. These fields are optional because the grants endpoint
does not return them; the component never fabricates publisher or activity data.

## Hooks

```tsx
const { isLoaded, isSignedIn, userId, session, signIn, signUp, signOut, getToken } = useAuth();
const { stepUp, handleStepUpCallback, reauthenticate } = useAuth();
const { user } = useUser(); // { id, email, emailVerified, phone, vendorData, verifiedIdentity, organizations }
```

- `getToken()` returns a short-lived access token for calling your own API.
- `user.vendorData` is your own id for the person, shared with Didit identity
  verification and transaction monitoring when the runtime supplies `vendor_data`;
  it remains `null` on runtimes that do not expose that field yet.

### Step-up before sensitive actions

Your application's step-up rules, set in the Didit console, can ask for a
liveness check, a selfie or an ID before a payout, a bank account change or a
contact change. Ask before the action:

```tsx
const check = await stepUp({ action: "payout", amount: "900.00", currency: "USD" });
if (check.approved) await payOut(); // no rule asked for a check

// Otherwise the check opened. Back on the page, with ?step_up=<id> in the address:
const outcome = await handleStepUpCallback();
if (outcome.approved) await payOut();
```

`action` is `payout`, `bank` or `contact`. Both resolve with
`{ id, status, approved, rule, method }`. The person comes back to the
`redirectUri` of `<DiditAuth>` (by default the page that asked);
`handleStepUpCallback` reads the outcome from Didit, never from the address.
Your backend reads the step-up again (`GET step-up/<id>/` with the person's
access token) before acting.

`reauthenticate()` signs the person in again on the hosted page and brings them
back to the current page (or `redirectUrl`), for actions that need a fresh
session.

### Your own sign-in screens

`useAuth()` also has the headless steps of `@didit-protocol/auth`:
`password.signIn`, `emailCode.start` and `verify`, `phone.start` and `verify`,
`protection.verify` and `passkey`, and `mfa.verify` and `setup`. Each resolves
with what to ask for next:

```tsx
const { password, protection, mfa } = useAuth();

let result = await password.signIn({ email, password: secret });
if (result.status === "protection_required") {
  // Didit's bot and risk protection wants one more proof: a code it just emailed, or a passkey.
  result = result.methods.includes("passkey") ? await protection.passkey() : await protection.verify({ code });
}
if (result.status === "mfa_required") result = await mfa.verify({ code: authenticatorCode });
if (result.status === "signed_in") navigate("/account");
```

`status` is `signed_in`, `code_sent`, `protection_required`, `mfa_required` or
`mfa_enrollment_required`. An emailed protection code does not replace MFA, so
`mfa_required` can follow it. Passkeys only work on your Didit sign-in domain.

## Appearance

Components follow the device's light or dark setting. Override it, and the
accent and font, with `appearance`:

```tsx
<DiditAuth publishableKey="pk_test_..." appearance={{ theme: "dark", brandColor: "#6B3CF6", fontFamily: "Inter" }}>
```

The same can be set in CSS with `--didit-auth-brand`, `--didit-auth-brand-dark`
and `--didit-auth-font`. Components use the surrounding page's font by default.
`nonce` adds a Content Security Policy nonce to the one `<style>` element the
provider renders. The embedded wordmark also requires `img-src data:`.

## Languages

English, Spanish, French, German and Japanese are built in. `locale` takes any
BCP 47 tag (`es-MX` uses Spanish); the default is the browser language, then
English.

## Your own client

`@didit-protocol/auth-react/provider` exports everything except the browser
binding: `DiditAuthProvider` takes any object implementing `AuthClient`. This
is how the Next.js package runs the same components on its server-side session.
