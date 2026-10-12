import Link from "next/link";

import { auth } from "@didit-protocol/auth-nextjs/server";

export default async function Home() {
  const { session } = await auth();

  if (session) {
    return (
      <section>
        <h1>You are signed in</h1>
        <p className="lead">As {session.user.email ?? session.user.phone}. This page was rendered on the server with your session.</p>
        <div className="actions">
          <Link href="/account" className="button primary">
            Open your account
          </Link>
        </div>
      </section>
    );
  }
  return (
    <section>
      <h1>Sign in with Didit</h1>
      <p className="lead">
        Create an account or sign in on your Didit sign-in page. Forgot your password? The sign-in page sends a reset
        link.
      </p>
      <div className="actions">
        <Link href="/sign-up" className="button primary">
          Create account
        </Link>
        <Link href="/sign-in" className="button">
          Sign in
        </Link>
      </div>
    </section>
  );
}
