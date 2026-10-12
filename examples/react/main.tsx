import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { DiditAuth, ConnectedAgents, SignedIn, SignedOut, SignIn, SignUp, UserButton, useAuth, useUser } from "@didit-protocol/auth-react";
import { exampleCopy } from "../shared/messages";
import "../nextjs/app/globals.css";

const locale = navigator.language;
const t = exampleCopy(locale);
document.documentElement.lang = locale;

function Account() {
  const { user } = useUser();
  const { stepUp } = useAuth();
  const [failed, setFailed] = useState(false);

  return <>
    <h1>{t.signedIn}</h1>
    <p>{user?.email ?? user?.phone}</p>
    <button className="button" onClick={() => stepUp().catch(() => setFailed(true))}>{t.stepUp}</button>
    {failed ? <p role="alert">{t.failed}</p> : null}
    <ConnectedAgents applicationName={t.app} />
  </>;
}

function App() {
  const path = window.location.pathname;

  if (path === "/sign-in") return <SignIn />;
  if (path === "/sign-up") return <SignUp />;

  return <>
    <header className="top"><a href="/" className="brand">{t.app}</a><UserButton /></header>
    <main>
      <SignedIn><Account /></SignedIn>
      <SignedOut>
        <h1>{t.welcome}</h1><p>{t.intro}</p>
        <div className="actions"><a className="button" href="/sign-in">{t.signIn}</a><a className="button primary" href="/sign-up">{t.signUp}</a></div>
      </SignedOut>
    </main>
  </>;
}

createRoot(document.getElementById("root")!).render(
  <DiditAuth publishableKey={import.meta.env.VITE_DIDIT_PUBLISHABLE_KEY} redirectUri={`${window.location.origin}/`} locale={locale}>
    <App />
  </DiditAuth>
);
