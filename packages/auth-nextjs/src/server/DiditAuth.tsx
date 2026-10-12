import { headers } from "next/headers";

import type { DiditSession } from "@didit-protocol/auth-react/provider";

import { DiditAuthRouteProvider } from "../client/DiditAuthRouteProvider.js";
import type { DiditAuthProps } from "../props.js";
import { auth } from "./auth.js";
import { negotiateLocale } from "./locale.js";

/** Wrap your root layout: the session is read on the server, so pages render signed in or out from the start. */
export async function DiditAuth({ children, appearance, locale, nonce }: DiditAuthProps) {
  let session: DiditSession | null = null;

  try {
    session = (await auth()).session;
  } catch (error) {
    console.error("[didit-auth] Could not read the session; rendering signed out.", error);
  }
  const language = locale ?? negotiateLocale((await headers()).get("accept-language"));

  return (
    <DiditAuthRouteProvider initialSession={session} appearance={appearance} locale={language} nonce={nonce}>
      {children}
    </DiditAuthRouteProvider>
  );
}
