import { diditAuthProxy } from "@didit-protocol/auth-nextjs/server";

// Serves /auth/* (sign-in, callback, sign-out, session), refreshes the session
// and sends signed-out visitors of /account to sign in. On Next.js 15 the same
// export goes in middleware.ts.
export default diditAuthProxy({ protect: ["/account"] });

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
