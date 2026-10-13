import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";

import type { DiditSession } from "@didit-protocol/auth-react/provider";

import { DiditAuthRouteProvider, type DiditAuthRouteProviderProps } from "../client/DiditAuthRouteProvider.js";
import type { DiditAuthProps } from "../props.js";
import { auth, settings } from "./auth.js";
import { negotiateLocale } from "./locale.js";

/** Wrap your root layout: the session is read on the server, so pages render signed in or out from the start. */
export async function DiditAuth({ children, appearance, locale, nonce }: DiditAuthProps) {
  let session: DiditSession | null = null;

  try {
    session = (await auth()).session;
  } catch (error) {
    // Next.js signals (dynamic rendering, redirects) must pass through.
    unstable_rethrow(error);
    console.error("[didit-auth] Could not read the session; rendering signed out.", error);
  }
  const language = locale ?? negotiateLocale((await headers()).get("accept-language"));
  // Headless sign-in screens run in the browser with the application's key and this app's callback.
  let headless: Pick<DiditAuthRouteProviderProps, "publishableKey" | "redirectUri"> = {};

  try {
    const { publishableKey, redirectUri } = settings();

    headless = { publishableKey, redirectUri };
  } catch {
    // auth() above already reported the configuration error.
  }

  return (
    <DiditAuthRouteProvider initialSession={session} appearance={appearance} locale={language} nonce={nonce} {...headless}>
      {children}
    </DiditAuthRouteProvider>
  );
}
