import { ConnectedAgents } from "@didit-protocol/auth-nextjs";

// Describe in words what each of your application's agent scopes allows.
// Scopes without a label show their name.
const scopeLabels = {
  "balance:read": "Sees your balance and payouts",
  "settings:write": "changes your settings",
  "payouts:request": "requests payouts (it asks you each time)",
  "payouts:read": "Sees your payouts. Read only"
};

export default function AgentsSettings() {
  return (
    <section>
      <h1>Connected agents</h1>
      <p className="lead">Revoking an agent ends its access everywhere at once.</p>
      <ConnectedAgents applicationName="Example app" scopeLabels={scopeLabels} />
    </section>
  );
}
