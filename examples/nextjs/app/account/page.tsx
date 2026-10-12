import Link from "next/link";

import { auth } from "@didit-protocol/auth-nextjs/server";

const DAY = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

export default async function Account() {
  // The proxy already sends signed-out visitors of /account to sign in;
  // protect() also refuses a session Didit has revoked since.
  const session = await auth.protect();
  const { user } = session;

  return (
    <section>
      <h1>Your account</h1>
      <p className="lead">Everything below comes from your Didit session, read on the server.</p>
      <dl className="facts">
        <dt>Email</dt>
        <dd data-testid="email">
          {user.email ?? "None"} {user.email ? (user.emailVerified ? "(verified)" : "(not verified)") : null}
        </dd>
        <dt>Phone</dt>
        <dd>{user.phone ?? "None"}</dd>
        <dt>Signed in with</dt>
        <dd data-testid="methods">{session.methods.join(", ")}</dd>
        <dt>Two-step verification</dt>
        <dd>{session.mfaVerified ? "Verified in this session" : "Not used in this session"}</dd>
        <dt>Session ends</dt>
        <dd>{DAY.format(new Date(session.expiresAt))}</dd>
      </dl>
      <div className="actions">
        <Link href="/account/security" className="button">
          Confirm it is you
        </Link>
        <Link href="/account/agents" className="button">
          Connected agents
        </Link>
      </div>
    </section>
  );
}
