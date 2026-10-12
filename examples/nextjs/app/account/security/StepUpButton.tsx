"use client";

import { useAuth } from "@didit-protocol/auth-nextjs";

export function StepUpButton() {
  const { stepUp } = useAuth();

  return (
    <button type="button" className="button primary" onClick={() => void stepUp()}>
      Sign in again to continue
    </button>
  );
}
