# React authentication example

A browser React app using the headless Authentication peer through `DiditAuth`.
It includes sign-in, account creation, hosted password reset, step-up, sign-out,
and connected agent revocation, with English, Spanish, French, German and Japanese copy.

Install `@didit-protocol/auth` once it is available, register
`http://localhost:3003/` on your Sandbox application, and set
`VITE_DIDIT_PUBLISHABLE_KEY` in `.env.local` using `.env.example`.

```sh
npm install @didit-protocol/auth
npm run build:auth
npm run dev -w @didit-protocol/example-auth-react
```

`SignUp` opens the hosted chooser, where Create account starts registration.
The hosted page also handles password reset. The React peer keeps tokens in
browser storage; choose the Next.js example for httpOnly server sessions.
The headless peer and its signals dependency must be installed before building
this example; the wrappers can be built independently through `build:auth`.

## End-to-end tests

Build the wrappers and install their headless peer, then run `npx playwright test`
from this directory with `VITE_DIDIT_PUBLISHABLE_KEY` and `E2E_MAILBOX` set.
`E2E_MAILBOX` is a JSON Lines email-delivery sink containing `{ to, subject, html }`.
The tests use real hosted signup, password reset, login, step-up and sign-out.
`E2E_SEED_GRANTS` is an optional fixture command receiving the synthetic email
as its last argument; set it to exercise real grant revocation too.
`E2E_CHROMIUM` can point to a locally installed Chromium executable.
The test runner owns and stops the Vite server it starts.
