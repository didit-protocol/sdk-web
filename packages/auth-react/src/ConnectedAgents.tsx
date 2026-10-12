"use client";

import { useEffect, useId, useState } from "react";

import { themeProps, useDiditAuthContext } from "./context.js";
import { useAuthSnapshot } from "./hooks.js";
import { format, messagesFor, type Messages } from "./i18n.js";
import { AlertCircleIcon, CheckCircleIcon, DiditLockup } from "./icons.js";
import type { AgentGrant } from "./types.js";

export interface AgentDetails {
  /** Localized publisher attribution supplied by your application's agent catalog. */
  publisherLabel?: string;
  /** Localized activity description supplied by your application's audit log. */
  activityLabel?: string;
}

export interface ConnectedAgentsProps {
  /** Your application's name, as people know it. */
  applicationName?: string;
  /**
   * What each permission lets an agent do, in the person's language, keyed by
   * the scope names you configured, for example
   * `{ "payouts:read": "Sees your payouts" }`. Unlabelled scopes show their name.
   */
  scopeLabels?: Record<string, string>;
  /** Optional display metadata from your app, keyed by agent id. Never inferred by the SDK. */
  agentDetails?: Record<string, AgentDetails>;
}

type Load = { kind: "loading" } | { kind: "error" } | { kind: "ready"; grants: AgentGrant[] };

interface Notice {
  kind: "revoked" | "error";
  agent: string;
}

const JUST_NOW_MS = 60_000;

function dayOf(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(iso));
}

function describe(grant: AgentGrant, labels: Record<string, string> | undefined, locale: string, t: Messages) {
  if (!grant.scopes.length) return null;
  const parts = grant.scopes.map((scope) => labels?.[scope] ?? scope);

  return format(t.agentsScopes, { list: new Intl.ListFormat(locale, { type: "conjunction" }).format(parts) });
}

/**
 * The AI agents the signed-in person allowed to act for them, each with a
 * Revoke button. Revoking ends the agent's access everywhere at once.
 */
export function ConnectedAgents(props: ConnectedAgentsProps) {
  const { session } = useAuthSnapshot();

  return session ? <AgentList key={session.id} {...props} /> : null;
}

function AgentList({ applicationName, scopeLabels, agentDetails }: ConnectedAgentsProps) {
  const { client, appearance, locale } = useDiditAuthContext();
  const { status, session } = useAuthSnapshot();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [revokedAt, setRevokedAt] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const titleId = useId();
  const t = messagesFor(locale);

  useEffect(function loadAgentGrants() {
    if (status !== "signed-in") return undefined;
    let live = true;

    setLoad({ kind: "loading" });
    setRevokedAt({});
    setNotice(null);
    client.listAgents().then(
      (grants) => live && setLoad({ kind: "ready", grants }),
      () => live && setLoad({ kind: "error" })
    );
    return () => {
      live = false;
    };
  }, [client, status, session?.id]);

  if (status !== "signed-in") return null;

  const now = Date.now();
  // Agents that can act now, plus the ones revoked here so the change stays visible.
  const rows =
    load.kind === "ready"
      ? load.grants.filter((grant) => revokedAt[grant.id] || (!grant.revokedAt && Date.parse(grant.expiresAt) > now))
      : [];

  async function revoke(grant: AgentGrant) {
    setBusy(grant.id);
    setNotice(null);
    try {
      await client.revokeAgent(grant.id);
      setRevokedAt((current) => ({ ...current, [grant.id]: Date.now() }));
      setNotice({ kind: "revoked", agent: grant.agentName });
    } catch {
      setNotice({ kind: "error", agent: grant.agentName });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      className="didit-auth didit-ca"
      aria-labelledby={titleId}
      aria-busy={load.kind === "loading"}
      {...themeProps(appearance)}
    >
      <div className="didit-ca-h">
        <h2 id={titleId} className="didit-ca-title">
          {t.agentsTitle}
        </h2>
        <p className="didit-ca-sub">
          {applicationName ? format(t.agentsSubtitle, { application: applicationName }) : t.agentsSubtitleGeneric}
        </p>
      </div>
      {rows.length ? (
        <ul className="didit-ca-list">
          {rows.map((grant) => {
            const gone = revokedAt[grant.id];
            const can = describe(grant, scopeLabels, locale, t);
            const details = agentDetails?.[grant.agentId];
            const meta = gone
              ? now - gone < JUST_NOW_MS
                ? t.agentsRevokedJustNow
                : format(t.agentsRevokedOn, { date: dayOf(new Date(gone).toISOString(), locale) })
              : format(t.agentsEnds, { date: dayOf(grant.expiresAt, locale) });

            return (
              <li key={grant.id} className={gone ? "didit-ca-r is-gone" : "didit-ca-r"}>
                <span className="didit-ca-av" aria-hidden="true">
                  {grant.agentName.trim().charAt(0).toUpperCase()}
                </span>
                <span className="didit-ca-tx">
                  <span className="didit-ca-n">
                    <b>{grant.agentName}</b>
                    {details?.publisherLabel ? <span>{details.publisherLabel}</span> : null}
                  </span>
                  {can ? <span className="didit-ca-d">{can}</span> : null}
                  <span className="didit-ca-m">{!gone && details?.activityLabel ? `${details.activityLabel} · ` : ""}{meta}</span>
                </span>
                {gone ? (
                  <span className="didit-status">{t.agentsRevoked}</span>
                ) : (
                  <button
                    type="button"
                    className="didit-ca-btn"
                    disabled={busy !== null}
                    aria-busy={busy === grant.id}
                    aria-label={`${t.agentsRevoke}: ${grant.agentName}`}
                    onClick={() => revoke(grant)}
                  >
                    {t.agentsRevoke}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {load.kind === "ready" && !rows.length ? <p className="didit-ca-empty">{t.agentsEmpty}</p> : null}
      {load.kind === "error" ? (
        <p className="didit-ca-empty" role="alert">
          {t.agentsLoadError}
        </p>
      ) : null}
      <div role="status" aria-live="polite">
        {notice ? (
          <div className={notice.kind === "error" ? "didit-ca-toast is-error" : "didit-ca-toast"}>
            {notice.kind === "error" ? <AlertCircleIcon /> : <CheckCircleIcon />}
            {format(notice.kind === "error" ? t.agentsRevokeError : t.agentsRevokedNotice, { agent: notice.agent })}
          </div>
        ) : null}
      </div>
      <div className="didit-ca-foot">
        {t.poweredBy}
        <DiditLockup />
      </div>
    </section>
  );
}
