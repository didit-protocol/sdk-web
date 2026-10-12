"use client";

import { useEffect, useId, useRef, useState } from "react";

import { themeProps, useDiditAuthContext } from "./context.js";
import { useAuthSnapshot } from "./hooks.js";
import { messagesFor } from "./i18n.js";
import type { DiditUser } from "./types.js";

export interface UserButtonProps {
  /** Where to go after signing out. Defaults to `/`. */
  afterSignOutUrl?: string;
}

/** Two letters for the avatar: from the email, else the last digits of the phone number. */
export function initialsOf(user: DiditUser): string {
  const local = user.email?.split("@")[0] ?? "";
  const words = local.split(/[._+-]+/).filter(Boolean);

  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  if (local) return local.slice(0, 2).toUpperCase();

  return (user.phone ?? "").replace(/\D/g, "").slice(-2);
}

/** The signed-in person's avatar, with a menu to sign out. */
export function UserButton({ afterSignOutUrl = "/" }: UserButtonProps) {
  const { client, appearance, locale } = useDiditAuthContext();
  const { session } = useAuthSnapshot();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const firstItem = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const t = messagesFor(locale);

  useEffect(function focusAccountMenu() {
    if (!open) return;
    firstItem.current?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>(".didit-ub-trigger")?.focus();
    };

    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!session) return null;
  const { user } = session;
  const initials = initialsOf(user);

  return (
    <div ref={root} className="didit-auth didit-ub" {...themeProps(appearance)}>
      <button
        type="button"
        className="didit-ub-trigger"
        aria-label={t.accountMenu}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="didit-ub-av" aria-hidden="true">
          {initials}
        </span>
      </button>
      {open ? (
        <div id={menuId} className="didit-ub-menu" role="menu" aria-label={t.accountMenu}>
          <div className="didit-ub-id">
            <span className="didit-ub-av" aria-hidden="true">
              {initials}
            </span>
            <span className="didit-ub-email">{user.email ?? user.phone}</span>
          </div>
          <button
            ref={firstItem}
            type="button"
            role="menuitem"
            className="didit-ub-item"
            onClick={() => {
              setOpen(false);
              client.signOut({ redirectUrl: afterSignOutUrl }).catch(() =>
                console.error("[didit-auth] Could not sign out.")
              );
            }}
          >
            {t.signOut}
          </button>
        </div>
      ) : null}
    </div>
  );
}
