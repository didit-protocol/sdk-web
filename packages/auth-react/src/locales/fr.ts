import type { Messages } from "./types.js";

export const fr: Messages = {
  agentsTitle: "Agents connectés",
  agentsSubtitle: "Agents d'IA que vous avez autorisés à agir en votre nom dans {application}.",
  agentsSubtitleGeneric: "Agents d'IA que vous avez autorisés à agir en votre nom.",
  agentsEmpty: "Aucun agent d'IA ne peut agir en votre nom pour le moment.",
  agentsLoadError: "Impossible de charger vos agents connectés. Réessayez plus tard.",
  agentsScopes: "{list}.",
  agentsEnds: "Prend fin le {date}",
  agentsRevokedJustNow: "Révoqué à l'instant",
  agentsRevokedOn: "Révoqué le {date}",
  agentsRevoke: "Révoquer",
  agentsRevoked: "Révoqué",
  agentsRevokedNotice: "La session de {agent} a pris fin partout. Il ne peut plus agir en votre nom tant que vous ne l'aurez pas de nouveau autorisé.",
  agentsRevokeError: "Impossible de révoquer {agent}. Réessayez.",
  poweredBy: "Propulsé par",
  accountMenu: "Compte",
  signOut: "Se déconnecter"
};
