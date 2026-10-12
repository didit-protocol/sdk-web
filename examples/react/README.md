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
