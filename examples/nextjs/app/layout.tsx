import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { DiditAuth, SignedIn, SignedOut, UserButton } from "@didit-protocol/auth-nextjs";

import "./globals.css";
import { pageCopy } from "./copy";

export const metadata: Metadata = { title: "Didit Authentication example" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale, t } = await pageCopy();

  return (
    <html lang={locale}>
      <body>
        <DiditAuth locale={locale}>
          <header className="top">
            <Link href="/" className="brand">
              {t.app}
            </Link>
            <nav>
              <SignedIn>
                <Link href="/account">{t.account}</Link>
                <UserButton />
              </SignedIn>
              <SignedOut>
                <Link href="/sign-in">{t.signIn}</Link>
                <Link href="/sign-up" className="button primary">
                  {t.signUp}
                </Link>
              </SignedOut>
            </nav>
          </header>
          <main>{children}</main>
        </DiditAuth>
      </body>
    </html>
  );
}
