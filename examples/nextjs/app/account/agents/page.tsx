import { ConnectedAgents } from "@didit-protocol/auth-nextjs";

export default function AgentsSettings() {
  return (
    <section>
      <h1>Connected agents</h1>
      <p className="lead">Revoking an agent ends its access everywhere at once.</p>
      {/* Pass scopeLabels to describe each permission in words, for example
          scopeLabels={{ "payouts:read": "Sees your payouts" }}. */}
      <ConnectedAgents applicationName="Example app" />
    </section>
  );
}
