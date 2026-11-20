"use client";

import { useEffect, useState } from "react";

import { DiditAuthProvider } from "@didit-protocol/auth-react/provider";
import type { DiditSession } from "@didit-protocol/auth-react/provider";

import type { DiditAuthProps } from "../props.js";
import { createRouteClient } from "./route-client.js";

export interface DiditAuthRouteProviderProps extends DiditAuthProps {
  /** The session the server rendered with. Omitted, the browser asks the proxy. */
  initialSession?: DiditSession | null;
  /** The application's publishable key, for headless sign-in. The server `<DiditAuth>` passes it. */
  publishableKey?: string;
  /** This app's registered callback (`DIDIT_REDIRECT_URI`), for headless sign-in. */
  redirectUri?: string;
}

export function DiditAuthRouteProvider({ initialSession, publishableKey, redirectUri, ...provider }: DiditAuthRouteProviderProps) {
  const [client] = useState(() => createRouteClient({ initialSession, publishableKey, redirectUri }));

  useEffect(function acceptServerSession() {
    if (initialSession !== undefined) client.setSession(initialSession);
  }, [client, initialSession]);

  return <DiditAuthProvider client={client} {...provider} />;
}
