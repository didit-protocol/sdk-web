"use client";

import { useMemo } from "react";

import { DiditAuthProvider, type DiditAuthProviderProps } from "./context.js";
import { createCoreAuthClient } from "./core.js";

export interface DiditAuthProps extends Omit<DiditAuthProviderProps, "client"> {
  /** Your application's publishable key, from Authentication > Developers in the Didit console. */
  publishableKey: string;
  /** Your Frontend API, when it should not be derived from the publishable key. */
  frontendApi?: string;
  /** The address Didit sends people back to after signing in. Defaults to the current page. */
  redirectUri?: string;
}

/** Signs people in with your Didit Authentication application, in the browser. */
export function DiditAuth({ publishableKey, frontendApi, redirectUri, ...provider }: DiditAuthProps) {
  const client = useMemo(
    () => createCoreAuthClient({ publishableKey, frontendApi, redirectUri }),
    [publishableKey, frontendApi, redirectUri]
  );

  return <DiditAuthProvider client={client} {...provider} />;
}
