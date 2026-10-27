"use client";

import type { ReactNode } from "react";

import { useAuthSnapshot } from "./hooks.js";

/** Renders its children only while someone is signed in. */
export function SignedIn({ children }: { children?: ReactNode }) {
  return useAuthSnapshot().status === "signed-in" ? <>{children}</> : null;
}

/** Renders its children only once the session is known and nobody is signed in. */
export function SignedOut({ children }: { children?: ReactNode }) {
  return useAuthSnapshot().status === "signed-out" ? <>{children}</> : null;
}
