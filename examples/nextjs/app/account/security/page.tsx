import { auth } from "@didit-protocol/auth-nextjs/server";

import { pageCopy } from "../../copy";

import { StepUpButton } from "./StepUpButton";

export default async function Security() {
  const session = await auth.protect();
  const { t } = await pageCopy();

  return (
    <section>
      <h1>{t.confirm}</h1>
      <p className="lead">
        {t.confirmCopy}
      </p>
      <dl className="facts">
        <dt>{t.methods}</dt>
        <dd data-testid="methods">{session.methods.join(", ")}</dd>
        <dt>{t.mfa}</dt>
        <dd>{session.mfaVerified ? t.mfaYes : t.mfaNo}</dd>
      </dl>
      <div className="actions">
        <StepUpButton label={t.stepUp} errorLabel={t.failed} />
      </div>
    </section>
  );
}
