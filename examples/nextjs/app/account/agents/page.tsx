import { ConnectedAgents } from "@didit-protocol/auth-nextjs";
import { pageCopy } from "../../copy";

export default async function AgentsSettings() {
  const { t } = await pageCopy();

  return (
    <section>
      <h1>{t.agents}</h1>
      <p className="lead">{t.revokeCopy}</p>
      <ConnectedAgents applicationName={t.app} />
    </section>
  );
}
