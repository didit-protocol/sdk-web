import Link from "next/link";

import { pageCopy } from "./copy";

import { auth } from "@didit-protocol/auth-nextjs/server";

export default async function Home() {
  const { session } = await auth();
  const { t } = await pageCopy();

  if (session) {
    return (
      <section>
        <h1>{t.signedIn}</h1>
        <p className="lead">{session.user.email ?? session.user.phone}</p>
        <div className="actions">
          <Link href="/account" className="button primary">
            {t.openAccount}
          </Link>
        </div>
      </section>
    );
  }
  return (
    <section>
      <h1>{t.welcome}</h1>
      <p className="lead">
        {t.intro}
      </p>
      <div className="actions">
        <Link href="/sign-up" className="button primary">
          {t.signUp}
        </Link>
        <Link href="/sign-in" className="button">
          {t.signIn}
        </Link>
      </div>
    </section>
  );
}
