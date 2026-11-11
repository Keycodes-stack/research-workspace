"use client";
import Link from "next/link";
import { useState } from "react";
import Shell from "@/components/Shell";
import { useLoad } from "@/components/useLoad";
import { api } from "@/lib/api";
import type { Mode } from "@/lib/types";

const MODE_TEXT: Record<Mode, string> = {
  open_discovery: "Open discovery (public literature)",
  closed_repository: "Closed repository (your own documents)",
};

function Projects() {
  const { data, error, loading, reload } = useLoad(() => api.projects());
  const [name, setName] = useState("");
  const [mode, setMode] = useState<Mode>("closed_repository");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setFormError(null);
    try { await api.createProject(name.trim(), mode); setName(""); await reload(); }
    catch (err) { setFormError(err instanceof Error ? err.message : "Could not create project"); }
    finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <div className="card" style={{ background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)", color: "#fff", border: "1px solid #4338ca" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ margin: "0 0 6px 0", color: "#e0e7ff" }}>✨ Halden R&D Intelligence Dashboard</h2>
            <p style={{ margin: 0, color: "#c7d2fe", fontSize: "14px" }}>
              Experience the multi-model comparison, technology radar, stage-gate kanban, and quote-verified lenses.
            </p>
          </div>
          <Link
            href="/intelligence"
            style={{
              padding: "10px 18px",
              borderRadius: "8px",
              background: "#4f46e5",
              color: "#fff",
              fontWeight: 600,
              textDecoration: "none",
              boxShadow: "0 4px 12px rgba(0,0,0,0.25)"
            }}
          >
            Launch Halden View →
          </Link>
        </div>
      </div>
      <div className="card">
        <h1>Projects</h1>
        <p className="muted">Each answer is built only from the documents in a project and every claim is checked against them.</p>
        {error && <div className="notice error" role="alert">{error}</div>}
        {loading && !data && <p className="muted">Loading…</p>}
        {data && data.length === 0 && <p className="muted">No projects yet. Create your first one below.</p>}
        <ul className="list">
          {data?.map((p) => (
            <li key={p.id} className="row between">
              <Link href={`/projects/${p.id}`}><strong>{p.name}</strong></Link>
              <span className="badge">{MODE_TEXT[p.mode]}</span>
            </li>
          ))}
        </ul>
      </div>
      <form className="card stack" onSubmit={create}>
        <h2>New project</h2>
        <label className="stack"><span>Name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required /></label>
        <label className="stack"><span>Source of truth</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            {(Object.keys(MODE_TEXT) as Mode[]).map((m) => <option key={m} value={m}>{MODE_TEXT[m]}</option>)}
          </select></label>
        {formError && <div className="notice error" role="alert">{formError}</div>}
        <div><button type="submit" disabled={busy || !name.trim()}>{busy ? "Creating…" : "Create project"}</button></div>
      </form>
    </div>
  );
}

export default function Home() {
  return <Shell><Projects /></Shell>;
}
