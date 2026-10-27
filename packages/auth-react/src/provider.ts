// Everything except the browser-core binding: the provider takes any AuthClient.
// @didit-protocol/auth-nextjs builds on this entry, so it never loads the core.
export { DiditAuthProvider, themeProps, useDiditAuthContext, type DiditAuthProviderProps } from "./context.js";
export { useAuth, useUser, type UseAuthResult, type UseUserResult } from "./hooks.js";
export { SignedIn, SignedOut } from "./control.js";
export { SignIn, SignUp, type SignInProps } from "./SignIn.js";
export { UserButton, type UserButtonProps } from "./UserButton.js";
export { ConnectedAgents, type AgentDetails, type ConnectedAgentsProps } from "./ConnectedAgents.js";
export { createAuthStore, snapshotOf, type AuthStore } from "./store.js";
export { resolveLocale, supportedLocales } from "./i18n.js";
export { safeReturnTo } from "./return-to.js";
export type {
  AgentGrant,
  Appearance,
  AuthClient,
  AuthSnapshot,
  AuthStatus,
  DiditOrganization,
  DiditSession,
  DiditUser,
  HeadlessSignIn,
  ProtectionMethod,
  RedirectOptions,
  SignInResult,
  StepUpAction,
  StepUpOptions,
  StepUpResult
} from "./types.js";
