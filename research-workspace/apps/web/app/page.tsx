"use client";
import { useEffect, useState } from "react";
import { consumeTokenFragment, getToken, setToken } from "@/lib/api";

/** Hosts the Halden workspace UI. The workspace only loads once the user holds a gateway-issued token. */
export default function Home() {
  const [token, setTok] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    consumeTokenFragment();
    setTok(getToken());
    // The workspace frame tells us when the gateway rejected the token (expired or revoked).
    const onMsg = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data === "kc:unauthorized") { setToken(null); setTok(null); }
    };
    // Opening a launcher link (#kc_token=...) in an already-open tab changes only the hash.
    const onHash = () => { consumeTokenFragment(); setTok(getToken()); };
    window.addEventListener("message", onMsg);
    window.addEventListener("hashchange", onHash);
    return () => { window.removeEventListener("message", onMsg); window.removeEventListener("hashchange", onHash); };
  }, []);

  if (token === undefined) return null;

  if (!token) {
    return (
      <main className="shell">
        <form
          className="card stack" style={{ maxWidth: 520, margin: "12vh auto 0" }}
          onSubmit={(e) => { e.preventDefault(); const t = draft.trim(); if (t) { setToken(t); setTok(t); } }}
        >
          <h1>Sign in</h1>
          <p className="muted">Paste the access token issued by your administrator. It is kept in this browser only.</p>
          <label htmlFor="token" className="sr-only">Access token</label>
          <input id="token" type="password" autoComplete="off" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Access token" />
          <button type="submit" disabled={!draft.trim()}>Continue</button>
        </form>
      </main>
    );
  }

  return (
    <div style={{ width: "100vw", height: "100vh", margin: 0, padding: 0, overflow: "hidden" }}>
      <iframe src="/halden.html" style={{ width: "100%", height: "100%", border: "none", display: "block" }} title="Halden R&D Intelligence" />
    </div>
  );
}
