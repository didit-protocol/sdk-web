import Link from "next/link";

import { auth } from "@didit-protocol/auth-nextjs/server";

import { pageCopy } from "../copy";

export default async function Account() {
  // The proxy already sends signed-out visitors of /account to sign in;
  // protect() also refuses a session Didit has revoked since.
  const session = await auth.protect();
  const { user } = session;
  const { locale, t } = await pageCopy();
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <section>
      <h1>{t.account}</h1>
      <dl className="facts">
        <dt>{t.email}</dt>
        <dd data-testid="email">
          {user.email ?? t.none} {user.email ? (user.emailVerified ? t.verified : t.unverified) : null}
        </dd>
        <dt>{t.phone}</dt>
        <dd>{user.phone ?? t.none}</dd>
        <dt>{t.methods}</dt>
        <dd data-testid="methods">{session.methods.join(", ")}</dd>
        <dt>{t.mfa}</dt>
        <dd>{session.mfaVerified ? t.mfaYes : t.mfaNo}</dd>
        <dt>{t.ends}</dt>
        <dd>{day.format(new Date(session.expiresAt))}</dd>
      </dl>
      <div className="actions">
        <Link href="/account/security" className="button">
          {t.confirm}
        </Link>
        <Link href="/account/agents" className="button">
          {t.agents}
        </Link>
      </div>
    </section>
  );
}
