# React authentication example

A browser React app using `@didit-protocol/auth` through `DiditAuth`.
It includes sign-in, account creation, hosted password reset, step-up, sign-out,
and connected agent revocation, with English, Spanish, French, German and Japanese copy.

Register `http://localhost:3003/` on your Sandbox application and set
`VITE_DIDIT_PUBLISHABLE_KEY` in `.env.local` using `.env.example`.
`build:auth` builds `@didit-protocol/signals`, `@didit-protocol/auth` and the
wrappers from this workspace.

```sh
npm install
npm run build:auth
npm run dev -w @didit-protocol/example-auth-react
```

`SignUp` opens the hosted chooser, where Create account starts registration.
The hosted page also handles password reset. `@didit-protocol/auth` keeps tokens in
browser storage; choose the Next.js example for httpOnly server sessions.

## End-to-end tests

Run `npm run build:auth`, then run `npx playwright test`
from this directory with `VITE_DIDIT_PUBLISHABLE_KEY` and `E2E_MAILBOX` set.
`E2E_MAILBOX` is a JSON Lines email-delivery sink containing `{ to, subject, html }`.
The tests use real hosted signup, password reset, login, step-up and sign-out.
`E2E_SEED_GRANTS` is an optional fixture command receiving the synthetic email
as its last argument; set it to exercise real grant revocation too.
`E2E_CHROMIUM` can point to a locally installed Chromium executable.
The test runner owns and stops the Vite server it starts.
