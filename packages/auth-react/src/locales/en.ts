import type { Messages } from "./types.js";

export const en: Messages = {
  agentsTitle: "Connected agents",
  agentsSubtitle: "AI agents you allowed to act for you in {application}.",
  agentsSubtitleGeneric: "AI agents you allowed to act for you.",
  agentsEmpty: "No AI agent can act for you right now.",
  agentsLoadError: "We could not load your connected agents. Try again later.",
  agentsScopes: "{list}.",
  agentsEnds: "Ends {date}",
  agentsRevokedJustNow: "Revoked just now",
  agentsRevokedOn: "Revoked {date}",
  agentsRevoke: "Revoke",
  agentsRevoked: "Revoked",
  agentsRevokedNotice: "{agent}'s session ended everywhere. It can't act for you until you approve it again.",
  agentsRevokeError: "We could not revoke {agent}. Try again.",
  poweredBy: "Powered by",
  signOutError: "We could not sign you out. Try again.",
  accountMenu: "Account",
  signOut: "Sign out"
};
