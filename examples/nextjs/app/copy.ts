import { headers } from "next/headers";
import { negotiateLocale } from "@didit-protocol/auth-nextjs/server";
import { exampleCopy } from "../../shared/messages";

export async function pageCopy() {
  const locale = negotiateLocale((await headers()).get("accept-language"));

  return { locale, t: exampleCopy(locale) };
}
