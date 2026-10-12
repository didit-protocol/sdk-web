"use client";

import { useCallback, useSyncExternalStore } from "react";

import { useDiditAuthContext } from "./context.js";
import type { AuthSnapshot, DiditSession, DiditUser, RedirectOptions } from "./types.js";

export function useAuthSnapshot(): AuthSnapshot {
  const { client } = useDiditAuthContext();

  return useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
}

export interface UseAuthResult {
  /** `false` until the session is known. */
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  sessionId: string | null;
  session: DiditSession | null;
  signIn(options?: RedirectOptions): Promise<void>;
  signUp(options?: RedirectOptions): Promise<void>;
  signOut(options?: RedirectOptions): Promise<void>;
  stepUp(options?: RedirectOptions): Promise<void>;
  getToken(): Promise<string | null>;
}

export function useAuth(): UseAuthResult {
  const { client } = useDiditAuthContext();
  const { status, session } = useAuthSnapshot();

  return {
    isLoaded: status !== "loading",
    isSignedIn: status === "signed-in",
    userId: session?.user.id ?? null,
    sessionId: session?.id ?? null,
    session,
    signIn: useCallback((options?: RedirectOptions) => client.signIn(options), [client]),
    signUp: useCallback((options?: RedirectOptions) => client.signUp(options), [client]),
    signOut: useCallback((options?: RedirectOptions) => client.signOut(options), [client]),
    stepUp: useCallback((options?: RedirectOptions) => client.stepUp(options), [client]),
    getToken: useCallback(() => client.getToken(), [client])
  };
}

export interface UseUserResult {
  isLoaded: boolean;
  isSignedIn: boolean;
  user: DiditUser | null;
}

export function useUser(): UseUserResult {
  const { status, session } = useAuthSnapshot();

  return { isLoaded: status !== "loading", isSignedIn: status === "signed-in", user: session?.user ?? null };
}
