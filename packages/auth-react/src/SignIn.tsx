"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { useDiditAuthContext } from "./context.js";
import { useAuthSnapshot } from "./hooks.js";
import { messagesFor } from "./i18n.js";
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
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(function openHostedPage() {
    if (status === "loading" || started.current) return;
    started.current = true;
    const target = safeReturnTo(redirectUrl) ?? returnToFromLocation() ?? "/";

    if (status === "signed-in") window.location.replace(target);
    else client[screen]({ redirectUrl: target }).catch(() => {
      started.current = false;
      setFailed(true);
    });
  }, [client, redirectUrl, screen, status, attempt]);

  return { failed, retry: () => { setFailed(false); setAttempt(value => value + 1); } };
}

function HostedRedirect({ screen, redirectUrl, fallback }: SignInProps & { screen: "signIn" | "signUp" }) {
  const { locale } = useDiditAuthContext();
  const { failed, retry } = useHostedRedirect(screen, redirectUrl);
  const messages = messagesFor(locale);

  if (failed) return <div role="alert"><p>{messages.signInError}</p><button onClick={retry}>{messages.retry}</button></div>;
  return <>{fallback}</>;
}

/** Sends the visitor to your Didit sign-in page, or onwards when already signed in. */
export function SignIn({ redirectUrl, fallback = null }: SignInProps) {
  return <HostedRedirect screen="signIn" redirectUrl={redirectUrl} fallback={fallback} />;
}

/** Sends the visitor to create an account on your Didit sign-in page. */
export function SignUp({ redirectUrl, fallback = null }: SignInProps) {
  return <HostedRedirect screen="signUp" redirectUrl={redirectUrl} fallback={fallback} />;
}
