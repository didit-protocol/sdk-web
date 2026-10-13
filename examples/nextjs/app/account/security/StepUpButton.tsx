"use client";

import { useState } from "react";
import { useAuth } from "@didit-protocol/auth-nextjs";

export function StepUpButton({ label, errorLabel }: { label: string; errorLabel: string }) {
  const { reauthenticate } = useAuth();
  const [failed, setFailed] = useState(false);

  return <>
    <button type="button" className="button primary" onClick={() => reauthenticate().catch(() => setFailed(true))}>
      {label}
    </button>
    {failed ? <p role="alert">{errorLabel}</p> : null}
  </>;
}
