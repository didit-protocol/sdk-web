// Client entry. Server components resolve index.server.ts through the
// "react-server" export condition.
export { DiditAuthRouteProvider as DiditAuth, type DiditAuthRouteProviderProps } from "./client/DiditAuthRouteProvider.js";
export { SignIn, SignUp } from "./client/SignIn.js";
export { ConnectedAgents, SignedIn, SignedOut, UserButton, useAuth, useUser } from "@didit-protocol/auth-react/provider";
export type {
  AgentDetails,
  AgentGrant,
  Appearance,
  ConnectedAgentsProps,
  DiditOrganization,
  DiditSession,
  DiditUser,
  HeadlessSignIn,
  ProtectionMethod,
  RedirectOptions,
  SignInResult,
  StepUpAction,
  StepUpOptions,
  StepUpResult,
  UseAuthResult,
  UseUserResult,
  UserButtonProps
} from "@didit-protocol/auth-react/provider";
export type { DiditAuthProps, SignInPageProps } from "./props.js";
