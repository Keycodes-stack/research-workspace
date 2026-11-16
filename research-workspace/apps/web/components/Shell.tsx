"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { consumeTokenFragment, getToken, setToken } from "@/lib/api";
import NotificationBell from "@/components/NotificationBell";

/** Page frame + sign-in gate. The gateway verifies the JWT; this only stores it. */
export default function Shell({ children, crumbs }: { children: React.ReactNode; crumbs?: React.ReactNode }) {
  const [token, setTok] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    consumeTokenFragment();
    setTok(getToken());
  }, []);

  if (token === undefined) return <div className="shell" />;

  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="brand">Keycodes Research Workspace</Link>
        {token && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <NotificationBell />
            <button className="secondary" onClick={() => { setToken(null); setTok(null); }}>Sign out</button>
          </div>
        )}
      </header>
      {token ? (
        <>
          {crumbs && <div className="crumbs">{crumbs}</div>}
          {children}
        </>
      ) : (
        <form
          className="card stack" style={{ maxWidth: 520 }}
          onSubmit={(e) => { e.preventDefault(); const t = draft.trim(); if (t) { setToken(t); setTok(t); } }}
        >
          <h1>Sign in</h1>
          <p className="muted">Paste the access token issued by your administrator. It is kept in this browser only.</p>
          <label htmlFor="token" className="sr-only">Access token</label>
          <input id="token" type="password" autoComplete="off" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Access token" />
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button type="submit" disabled={!draft.trim()}>Continue</button>
          </div>
        </form>
      )}
    </div>
  );
}
