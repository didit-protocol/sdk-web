import { redirect, unstable_rethrow } from "next/navigation";

import { BASE_PATH } from "../constants.js";
import type { SignInPageProps } from "../props.js";
import { auth } from "./auth.js";
import { safeReturnTo } from "./return-to.js";

async function hostedRedirect(route: "sign-in" | "sign-up", { searchParams }: SignInPageProps): Promise<never> {
  const query = searchParams ? await searchParams : {};
  const requested = Array.isArray(query.redirect_url) ? query.redirect_url[0] : query.redirect_url;
  const target = safeReturnTo(requested) ?? "/";
  let signedIn = false;

  try {
    signedIn = Boolean((await auth()).session);
  } catch (error) {
    unstable_rethrow(error);
    signedIn = false;
  }
  redirect(signedIn ? target : `${BASE_PATH}/${route}?redirect_url=${encodeURIComponent(target)}`);
}

/** A sign-in page: `export { SignIn as default } from '@didit-protocol/auth-nextjs'`. */
export async function SignIn(props: SignInPageProps) {
  return hostedRedirect("sign-in", props);
}

/** A sign-up page: `export { SignUp as default } from '@didit-protocol/auth-nextjs'`. */
export async function SignUp(props: SignInPageProps) {
  return hostedRedirect("sign-up", props);
}
