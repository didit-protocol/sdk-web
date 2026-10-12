# Didit Authentication: Next.js example

A small Next.js app that signs people up and in with Didit Authentication:

- `/sign-up` and `/sign-in` open your Didit sign-in page, which also handles
  forgotten passwords (it offers a reset link after a failed attempt).
- `/account` is protected by the proxy and rendered on the server with
  `auth.protect()`.
- `/account/security` asks the person to sign in again before a sensitive change.
- `/account/agents` lists the AI agents the person connected, with Revoke.
- The header shows `<UserButton />` with sign-out once someone is signed in.

## Run it

1. In the Didit console, open your Sandbox application, turn Authentication on
   and add `http://localhost:3000/auth/callback` as a redirect address.
2. Copy `.env.example` to `.env.local` and fill in your values.
3. From the repository root:

```bash
npm install
npm run build:auth
cd examples/nextjs
npm run dev
```

## End-to-end tests

`e2e/auth.spec.ts` runs every flow against a real Frontend API with Playwright:
sign-up with the emailed code, server rendering, token refresh, agent
revocation, signing in again, sign-out and password reset. It reads the emails
from `E2E_MAILBOX`, a JSON Lines file with one `{ "to", "subject", "html" }`
object per email your test environment sends, and is skipped without it.

```bash
npm run build
DIDIT_FRONTEND_API=... DIDIT_REDIRECT_URI=http://localhost:3000/auth/callback \
E2E_MAILBOX=/path/to/mail.jsonl npx playwright test
```

Optional: `E2E_SEED_GRANTS` names a command that gives the new person agent
grants (it receives the email as its last argument), so the agents test has
something to revoke. `E2E_CHROMIUM` points Playwright at a local Chromium.
