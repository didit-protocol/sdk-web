# @didit-protocol/auth-nextjs

Didit Authentication for the Next.js App Router: people sign up and in on your
Didit sign-in page, the session lives in httpOnly cookies, and server
components, route handlers and server actions read it with `auth()`.

Requires Next.js 15.5 or later and React 19.

## Install

```bash
npm install @didit-protocol/auth-nextjs
```

```bash
# .env.local
# Authentication > Developers in the Didit console.
DIDIT_PUBLISHABLE_KEY=pk_test_...
# Register this exact address as a redirect address of the application.
DIDIT_REDIRECT_URI=http://localhost:3000/auth/callback
```

The publishable key names your application's sign-in domain, its Frontend
API, so there is no other address to set. A key that is not a Didit key fails
at startup with `DiditAuthConfigError`.

## Set up

```ts
// proxy.ts (Next.js 16) or middleware.ts (Next.js 15)
import { diditAuthProxy } from "@didit-protocol/auth-nextjs/server";

export default diditAuthProxy({ protect: ["/account"] });

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
```

```tsx
// app/layout.tsx
import { DiditAuth } from "@didit-protocol/auth-nextjs";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DiditAuth>{children}</DiditAuth>
      </body>
    </html>
  );
}
```

```ts
// app/sign-in/page.tsx
export { SignIn as default } from "@didit-protocol/auth-nextjs";
```

`<SignUp />` works the same way on `app/sign-up/page.tsx`. Both open the hosted method chooser, where Create account starts registration,
and send someone already signed in straight on to `redirect_url`.

## Read the session on the server

```tsx
import { auth } from "@didit-protocol/auth-nextjs/server";

export default async function Account() {
  const session = await auth.protect(); // or: const { session, userId, getToken } = await auth();

  return <p>{session.user.email}</p>;
}
```

`auth()` checks the session with Didit, so a session revoked from the console
or from another device stops working within `DIDIT_SESSION_CACHE_SECONDS`
(default 30, set 0 to check every time). `auth.protect()` sends a signed-out
visitor to sign in and back to the page they asked for.

## Components and hooks

`<SignedIn>`, `<SignedOut>`, `<UserButton />`, `<ConnectedAgents />`, `useAuth()`
and `useUser()` are those of
[`@didit-protocol/auth-react`](../auth-react), re-exported. Under `<DiditAuth>`
they render signed in or out from the first server render. `useAuth().getToken()`
returns the person's short-lived access token for calling your own API.

## Step-up before sensitive actions

```tsx
const { stepUp, handleStepUpCallback } = useAuth();

const check = await stepUp({ action: "payout", amount: "900.00", currency: "USD" });
if (check.approved) await payOut(); // no rule asked for a check

// Otherwise the identity check opened. Back on this page, with ?step_up=<id>:
const outcome = await handleStepUpCallback();
if (outcome.approved) await payOut(outcome.id);
```

Didit returns the person to `DIDIT_REDIRECT_URI` and the proxy brings them back
to the page that asked, with only the step-up's id in the address. What runs
in a browser can be changed, so the server action reads the step-up again
before acting:

```ts
import { auth } from "@didit-protocol/auth-nextjs/server";

const check = await (await auth()).getStepUp(stepUpId); // null when signed out
if (!check?.approved) throw new Error("Step-up required");
```
`useAuth().reauthenticate()` signs the person in again on the hosted page
instead, for actions that need a fresh session.

## Your own sign-in screens

`useAuth()` has the headless steps of `@didit-protocol/auth` (`password`,
`emailCode`, `phone`, `protection`, `mfa`), with the same results as in
[`@didit-protocol/auth-react`](../auth-react), including `protection_required`
when Didit's bot and risk protection asks for an emailed code or a passkey.
The steps run in the browser, straight to Didit, so its protection and rate
limits see the person rather than your server; the one-time code that ends
them goes to `/auth/exchange`, so the tokens only ever live in the cookies.
Add your app's origin (for example `http://localhost:3000`) to the
application's allowed origins in the Didit console. Passkeys only work on your
Didit sign-in domain.

## Routes

The proxy serves these routes; your app needs no route files for them.

| Route | Purpose |
| --- | --- |
| `GET /auth/sign-in`, `/auth/sign-up`, `/auth/reauthenticate` | Open the hosted page with PKCE. `redirect_url` (a path in your app) is where the person comes back to. |
| `GET` the path of `DIDIT_REDIRECT_URI` | Checks the state, exchanges the code and stores the session. Brings a person back from a step-up's check. |
| `POST /auth/sign-out` | Ends the session at Didit and clears the cookies. |
| `POST /auth/step-up`, `GET /auth/step-up/{id}` | Asks the application's step-up rules about an action, and reads a step-up's outcome. |
| `POST /auth/exchange` | Completes a headless sign-in: exchanges its one-time code and stores the session. |
| `GET /auth/session`, `GET /auth/token` | The session and the access token, for this app's own pages. |
| `GET /auth/agents`, `DELETE /auth/agents/{id}` | The person's agent grants, for `<ConnectedAgents />`. |

Every other request passes through. When the access token has expired the proxy
rotates the refresh token first, so pages render with a valid session.

## Security

- The access and refresh tokens are in `httpOnly`, `SameSite=Lax` cookies;
  over HTTPS they are `Secure` and `__Host-` prefixed.
- Each sign-in has its own PKCE verifier and state in a ten-minute cookie; the
  callback refuses a state it did not issue.
- `redirect_url` only accepts paths in your app.
- `sign-out`, step-up, the code exchange and agent revocation only accept
  requests from your own origin, and the JSON routes only answer this SDK's
  client.
- A refresh token is spent once per server process even when parallel requests
  need it: Didit ends a session whose refresh token is reused. Apps on several
  server instances can still race on a refresh at the same moment; the session
  then ends and the person signs in again.
- `http` is accepted for `localhost` only.

- Reauthentication requires an existing session and binds the callback to that
  same person. A different identity is refused and its new session is revoked.
  A browser that opens it with no session left is sent on to the sign-in page,
  so the person is never left looking at a JSON answer.
- A step-up's outcome is read from Didit with the person's session, never from
  the address it came back with.
- Sign-out reports an upstream failure and retains the browser session so the
  person can retry. It does not report success before revocation succeeds.
- Session and refresh caches are isolated by application origin. Cached sessions
  never outlive their expiry. Access tokens may be opaque or JWT-shaped;
  authorization still uses the runtime session endpoint, not unverified claims.

English, Spanish, French, German and Japanese copy follows `Accept-Language`.
Connected agents are paginated through the runtime API; optional publisher and
activity labels come from your own application, as described in the React package.
