"use client";

import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";

import { resolveLocale } from "./i18n.js";
import { stylesheet } from "./styles.js";
import type { Appearance, AuthClient } from "./types.js";

interface DiditAuthContextValue {
  client: AuthClient;
  appearance: Appearance;
  locale: string;
  /** The client could not load the session: components read as signed out instead of waiting forever. */
  sessionUnavailable: boolean;
}

const DiditAuthContext = createContext<DiditAuthContextValue | null>(null);

export interface DiditAuthProviderProps {
  client: AuthClient;
  appearance?: Appearance;
  /** A BCP 47 language tag. Defaults to the browser language; English, Spanish, French, German and Japanese are built in. */
  locale?: string;
  /** Nonce for the provider's `<style>` element under a strict Content Security Policy. */
  nonce?: string;
  children?: ReactNode;
}

/** Makes an authentication client available to every Didit component and hook below it. */
export function DiditAuthProvider({ client, appearance, locale, nonce, children }: DiditAuthProviderProps) {
  const [sessionUnavailable, setSessionUnavailable] = useState(false);
  // The browser language is read after mount, so server rendering and hydration agree on English.
  const [browserLocale, setBrowserLocale] = useState("en");

  useEffect(function loadSession() {
    let live = true;
    setSessionUnavailable(false);
    client.load().catch(() => {
      if (!live) return;
      setSessionUnavailable(true);
      console.error("[didit-auth] Could not load the session.");
    });

    return () => {
      live = false;
    };
  }, [client]);

  useEffect(function readBrowserLocale() {
    if (typeof navigator !== "undefined") setBrowserLocale(navigator.language);
  }, []);

  const value = useMemo(
    () => ({
      client,
      appearance: appearance ?? {},
      locale: resolveLocale(locale ?? browserLocale),
      sessionUnavailable
    }),
    [client, appearance, locale, browserLocale, sessionUnavailable]
  );

  return (
    <DiditAuthContext.Provider value={value}>
      <style nonce={nonce} data-didit-auth="" dangerouslySetInnerHTML={{ __html: stylesheet }} />
      {children}
    </DiditAuthContext.Provider>
  );
}

export function useDiditAuthContext(): DiditAuthContextValue {
  const value = useContext(DiditAuthContext);

  if (!value) throw new Error("Didit components and hooks must be rendered inside <DiditAuth>.");

  return value;
}

/** The theme attribute and CSS variables every component root carries. */
export function themeProps(appearance: Appearance): { "data-didit-theme": string; style?: CSSProperties } {
  const style: Record<string, string> = {};

  if (appearance.brandColor) style["--didit-auth-brand"] = appearance.brandColor;
  if (appearance.fontFamily) style["--didit-auth-font"] = appearance.fontFamily;

  return {
    "data-didit-theme": appearance.theme ?? "auto",
    ...(Object.keys(style).length ? { style: style as CSSProperties } : {})
  };
}
