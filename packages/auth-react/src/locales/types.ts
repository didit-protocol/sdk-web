export interface Messages {
  agentsTitle: string;
  /** `{application}` is the name of your application. */
  agentsSubtitle: string;
  agentsSubtitleGeneric: string;
  agentsEmpty: string;
  agentsLoadError: string;
  /** `{list}` is the agent's permissions joined as a list. */
  agentsScopes: string;
  /** `{date}` is the day the grant ends. */
  agentsEnds: string;
  agentsRevokedJustNow: string;
  /** `{date}` is the day the grant was revoked. */
  agentsRevokedOn: string;
  agentsRevoke: string;
  agentsRevoked: string;
  /** `{agent}` is the agent's name. */
  agentsRevokedNotice: string;
  /** `{agent}` is the agent's name. */
  agentsRevokeError: string;
  poweredBy: string;
  accountMenu: string;
  signOut: string;
  signOutError: string;
}
