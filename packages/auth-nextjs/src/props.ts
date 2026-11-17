import type { ReactNode } from "react";

import type { Appearance } from "@didit-protocol/auth-react/provider";

export interface DiditAuthProps {
  appearance?: Appearance;
  /** A BCP 47 language tag. Defaults to the visitor's `Accept-Language`. */
  locale?: string;
  /** Nonce for the components' `<style>` element under a strict Content Security Policy. */
  nonce?: string;
  children?: ReactNode;
}

/** Page props, so `export { SignIn as default }` works as a Next.js page. */
export interface SignInPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}
