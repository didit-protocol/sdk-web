"use client";

import { useCallback, useSyncExternalStore } from "react";

import { useDiditAuthContext } from "./context.js";
import type {
  AuthSnapshot,
  DiditSession,
  DiditUser,
  HeadlessSignIn,
  RedirectOptions,
  StepUpOptions,
  StepUpResult
} from "./types.js";

export function useAuthSnapshot(): AuthSnapshot {
  const { client, sessionUnavailable } = useDiditAuthContext();
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);

  // A client that cannot load the session reads as signed out, so protected screens render their
  // guest state instead of waiting on a load that already failed.
  return sessionUnavailable && snapshot.status === "loading" ? { status: "signed-out", session: null } : snapshot;
}

export interface UseAuthResult extends HeadlessSignIn {
  /** `false` until the session is known. */
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  sessionId: string | null;
  session: DiditSession | null;
  signIn(options?: RedirectOptions): Promise<void>;
  signUp(options?: RedirectOptions): Promise<void>;
  signOut(options?: RedirectOptions): Promise<void>;
  stepUp(options: StepUpOptions): Promise<StepUpResult>;
  handleStepUpCallback(url?: string): Promise<StepUpResult>;
  reauthenticate(options?: RedirectOptions): Promise<void>;
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
    stepUp: useCallback((options: StepUpOptions) => client.stepUp(options), [client]),
    handleStepUpCallback: useCallback((url?: string) => client.handleStepUpCallback(url), [client]),
    reauthenticate: useCallback((options?: RedirectOptions) => client.reauthenticate(options), [client]),
    getToken: useCallback(() => client.getToken(), [client]),
    password: client.password,
    emailCode: client.emailCode,
    phone: client.phone,
    protection: client.protection,
    mfa: client.mfa
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
