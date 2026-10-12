import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { DiditAuth, SignedIn, SignedOut, UserButton } from "@didit-protocol/auth-nextjs";

import "./globals.css";

export const metadata: Metadata = { title: "Didit Authentication example" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DiditAuth>
          <header className="top">
            <Link href="/" className="brand">
              Example app
            </Link>
            <nav>
              <SignedIn>
                <Link href="/account">Account</Link>
                <UserButton />
              </SignedIn>
              <SignedOut>
                <Link href="/sign-in">Sign in</Link>
                <Link href="/sign-up" className="button primary">
                  Create account
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
