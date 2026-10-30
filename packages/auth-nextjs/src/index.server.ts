// Server-component entry, picked by the "react-server" export condition. The
// types come from index.ts, whose exports this mirrors.
export { DiditAuth } from "./server/DiditAuth.js";
export { SignIn, SignUp } from "./server/SignIn.js";
export { ConnectedAgents, SignedIn, SignedOut, UserButton, useAuth, useUser } from "@didit-protocol/auth-react/provider";
