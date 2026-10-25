"use client";

import { SignIn as HostedSignIn, SignUp as HostedSignUp } from "@didit-protocol/auth-react/provider";

import type { SignInPageProps } from "../props.js";

// Used when a client component imports these; server components get the server redirects.
export function SignIn(_props: SignInPageProps) {
  return <HostedSignIn />;
}

export function SignUp(_props: SignInPageProps) {
  return <HostedSignUp />;
}
