"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { useLoad } from "@/components/useLoad";
import { api } from "@/lib/api";

function Body({ id }: { id: string }) {
  const task = useLoad(() => api.task(id), [id]);
  const sources = useLoad(async () => api.sources((await api.task(id)).project_id), [id]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (task.data) setPicked(new Set(task.data.source_ids)); }, [task.data]);

  const t = task.data;
  const locked = !!t && t.status !== "draft";
  const eligible = (sources.data ?? []).filter((s) => s.chunks > 0);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErr(null);
    try { await fn(); await task.reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Request failed"); }
    finally { setBusy(false); }
  }

  const toggle = (sid: string) => setPicked((p) => { const n = new Set(p); n.has(sid) ? n.delete(sid) : n.add(sid); return n; });
  const saved = t ? [...t.source_ids].sort().join() === [...picked].sort().join() : true;

  async function openThread() {
    setBusy(true);
    try { const th = await api.createThread(id); window.location.assign(`/threads/${th.id}`); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not start a session"); setBusy(false); }
  }

  return (
    <div className="stack">
      {t && (
        <div className="nav-back-bar">
          <Link href={`/projects/${t.project_id}`} className="nav-back-link">
            ← Back to Project Overview
          </Link>
          <Link href={`/projects/${t.project_id}/signals`} className="nav-back-link">
            📡 Signal Board
          </Link>
          <Link href={`/projects/${t.project_id}/concepts`} className="nav-back-link">
            💡 Concepts Hub
          </Link>
          <Link href={`/projects/${t.project_id}/pipeline`} className="nav-back-link">
            📋 Pipeline (Kanban)
          </Link>
        </div>
      )}
      <div className="card">
        <div className="row between">
          <h1>{t?.title ?? "Task"}</h1>
          {t && <span className={`badge ${locked ? "ok" : "warn"}`}>{locked ? "Approved and locked" : "Awaiting approval"}</span>}
        </div>
        {task.error && <div className="notice error" role="alert">{task.error}</div>}
        {err && <div className="notice error" role="alert">{err}</div>}
        {t?.source_lock_hash && <p className="muted">Source lock <span className="hash">{t.source_lock_hash.slice(0, 16)}…</span>. If any selected source changes, questions are refused.</p>}
      </div>

      <div className="card stack">
        <h2>Approved sources</h2>
        {!locked && <p className="muted">Choose the documents the AI may use. After approval this list cannot be changed.</p>}
        {sources.data && eligible.length === 0 && <p className="muted">No indexed sources yet. Add some on the project page.</p>}
        <ul className="list">
          {eligible.map((s) => (
            <li key={s.id}>
              <label className="row">
                <input type="checkbox" checked={picked.has(s.id)} disabled={locked || busy} onChange={() => toggle(s.id)} />
                <span><strong>{s.title ?? s.filename ?? "Untitled"}</strong> <span className="muted">{s.chunks} passages{s.fulltext === "abstract_only" ? " · abstract only" : ""}</span></span>
              </label>
            </li>
          ))}
        </ul>
        {!locked && (
          <div className="row">
            <button className="secondary" disabled={busy || saved} onClick={() => void run(() => api.setTaskSources(id, [...picked]))}>Save selection</button>
            <button disabled={busy || !saved || picked.size === 0} onClick={() => void run(() => api.approve(id))}
              title={!saved ? "Save the selection first" : undefined}>Approve and lock sources</button>
          </div>
        )}
      </div>

      <div className="card stack">
        <div className="row between"><h2>Research sessions</h2>
          <button disabled={busy || (t?.mode === "closed_repository" && !locked)} onClick={() => void openThread()}>New session</button></div>
        {t?.mode === "closed_repository" && !locked && <p className="muted">Approve the task before asking questions.</p>}
        <ul className="list">
          {t?.threads.map((th) => (
            <li key={th.id}><Link href={`/threads/${th.id}`}>{th.title ?? new Date(th.created_at).toLocaleString()}</Link></li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Shell crumbs={<Link href="/">Projects</Link>}><Body id={id} /></Shell>;
}
