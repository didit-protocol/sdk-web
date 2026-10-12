import { auth } from "@didit-protocol/auth-nextjs/server";

import { StepUpButton } from "./StepUpButton";

export default async function Security() {
  const session = await auth.protect();

  return (
    <section>
      <h1>Confirm it is you</h1>
      <p className="lead">
        Before a sensitive change, such as a payout or a new bank account, ask the person to sign in again. They come
        back to this page with a new session.
      </p>
      <dl className="facts">
        <dt>Signed in with</dt>
        <dd data-testid="methods">{session.methods.join(", ")}</dd>
        <dt>Two-step verification</dt>
        <dd>{session.mfaVerified ? "Verified in this session" : "Not used in this session"}</dd>
      </dl>
      <div className="actions">
        <StepUpButton />
      </div>
    </section>
  );
}
