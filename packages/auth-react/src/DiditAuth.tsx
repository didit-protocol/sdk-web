"use client";

import { useMemo } from "react";

import { DiditAuthProvider, type DiditAuthProviderProps } from "./context.js";
import { resolveLocale } from "./i18n.js";
import { createCoreAuthClient } from "./core.js";

export interface DiditAuthProps extends Omit<DiditAuthProviderProps, "client"> {
  /** Your application's publishable key, from Authentication > Developers in the Didit console. */
  publishableKey: string;
  /** The address Didit sends people back to after signing in. Defaults to the current page. */
  redirectUri?: string;
}

/** Signs people in with your Didit Authentication application, in the browser. */
export function DiditAuth({ publishableKey, redirectUri, locale, ...provider }: DiditAuthProps) {
  const client = useMemo(
    () => createCoreAuthClient({ publishableKey, redirectUri, language: locale ? resolveLocale(locale) : undefined }),
    [publishableKey, redirectUri, locale]
  );

  return <DiditAuthProvider client={client} locale={locale} {...provider} />;
}
