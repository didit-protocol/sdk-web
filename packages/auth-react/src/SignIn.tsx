"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { useDiditAuthContext } from "./context.js";
import { useAuthSnapshot } from "./hooks.js";
import { returnToFromLocation, safeReturnTo } from "./return-to.js";

export interface SignInProps {
  /** Where to go after signing in. Defaults to the page's `redirect_url`, then `/`. */
  redirectUrl?: string;
  /** Rendered while the hosted page opens. */
  fallback?: ReactNode;
}

function useHostedRedirect(screen: "signIn" | "signUp", redirectUrl: string | undefined) {
  const { client } = useDiditAuthContext();
  const { status } = useAuthSnapshot();
  const started = useRef(false);

  useEffect(() => {
    if (status === "loading" || started.current) return;
    started.current = true;
    const target = safeReturnTo(redirectUrl) ?? returnToFromLocation() ?? "/";

    if (status === "signed-in") window.location.replace(target);
    else void client[screen]({ redirectUrl: target });
  }, [client, redirectUrl, screen, status]);
}

/** Sends the visitor to your Didit sign-in page, or onwards when already signed in. */
export function SignIn({ redirectUrl, fallback = null }: SignInProps) {
  useHostedRedirect("signIn", redirectUrl);
  return <>{fallback}</>;
}

/** Sends the visitor to create an account on your Didit sign-in page. */
export function SignUp({ redirectUrl, fallback = null }: SignInProps) {
  useHostedRedirect("signUp", redirectUrl);
  return <>{fallback}</>;
}
