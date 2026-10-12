"use client";

import { useEffect, useState } from "react";

import { DiditAuthProvider } from "@didit-protocol/auth-react/provider";
import type { DiditSession } from "@didit-protocol/auth-react/provider";

import type { DiditAuthProps } from "../props.js";
import { createRouteClient } from "./route-client.js";

export interface DiditAuthRouteProviderProps extends DiditAuthProps {
  /** The session the server rendered with. Omitted, the browser asks the proxy. */
  initialSession?: DiditSession | null;
}

export function DiditAuthRouteProvider({ initialSession, ...provider }: DiditAuthRouteProviderProps) {
  const [client] = useState(() => createRouteClient({ initialSession }));

  useEffect(() => {
    if (initialSession !== undefined) client.setSession(initialSession);
  }, [client, initialSession]);

  return <DiditAuthProvider client={client} {...provider} />;
}
