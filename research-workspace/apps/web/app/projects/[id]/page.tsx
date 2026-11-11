"use client";
import Link from "next/link";
import { use, useRef, useState } from "react";
import Shell from "@/components/Shell";
import ProjectNav from "@/components/ProjectNav";
import { useLoad } from "@/components/useLoad";
import { api } from "@/lib/api";

const FULLTEXT: Record<string, string> = {
  full_text: "Full text", abstract_only: "Abstract only", pending: "Processing", failed: "Failed",
};

function Body({ id }: { id: string }) {
  const project = useLoad(() => api.project(id), [id]);
  const sources = useLoad(() => api.sources(id), [id]);
  const tasks = useLoad(() => api.tasks(id), [id]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState("");
  const [title, setTitle] = useState("");

  const closed = project.data?.mode === "closed_repository";

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setMsg(null);
    const failed: string[] = [];
    for (const f of Array.from(files)) {
      try { await api.upload(id, f); } catch (e) { failed.push(`${f.name}: ${e instanceof Error ? e.message : "failed"}`); }
    }
    if (fileRef.current) fileRef.current.value = "";
    setMsg(failed.length ? { kind: "error", text: failed.join(" · ") } : { kind: "ok", text: "Uploaded and indexed." });
    setBusy(false);
    await sources.reload();
  }

  async function discover(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const r = await api.discover(id, question.trim());
      setMsg({ kind: r.errors.length ? "error" : "ok", text: `Found and indexed ${r.sources.length} paper(s).${r.errors.length ? " " + r.errors.join(" · ") : ""}` });
      await sources.reload();
    } catch (err) { setMsg({ kind: "error", text: err instanceof Error ? err.message : "Search failed" }); }
    finally { setBusy(false); }
  }

  async function newTask(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { const t = await api.createTask(id, title.trim()); window.location.assign(`/tasks/${t.id}`); }
    catch (err) { setMsg({ kind: "error", text: err instanceof Error ? err.message : "Could not create task" }); setBusy(false); }
  }

  return (
    <div className="stack">
      <ProjectNav
        projectId={id}
        activeTab="overview"
        projectName={project.data?.name}
        role={project.data?.role}
      />
      {project.error && <div className="notice error" role="alert">{project.error}</div>}
      {project.data && (
        <div className="card" style={{ padding: "10px 16px", marginTop: "-10px" }}>
          <p className="muted" style={{ margin: 0 }}>
            {closed
              ? "🔒 Closed repository: answers use only the documents you upload."
              : "🌐 Open discovery: answers use public papers found for your question."}
          </p>
        </div>
      )}

      <div className="card stack">
        <h2>Sources</h2>
        {msg && <div className={`notice ${msg.kind === "error" ? "error" : ""}`} role="status">{msg.text}</div>}
        {closed ? (
          <div>
            <label className="btn" style={{ display: "inline-block" }}>
              {busy ? "Working…" : "Upload PDFs"}
              <input ref={fileRef} type="file" accept="application/pdf" multiple hidden disabled={busy}
                onChange={(e) => void upload(e.target.files)} />
            </label>
            <span className="muted"> Text-based PDFs only. Scanned documents are not supported yet.</span>
          </div>
        ) : (
          <form className="stack" onSubmit={discover}>
            <label className="stack"><span>Research question</span>
              <textarea value={question} onChange={(e) => setQuestion(e.target.value)} required minLength={3} /></label>
            <div><button type="submit" disabled={busy || question.trim().length < 3}>{busy ? "Searching…" : "Find and index papers"}</button></div>
          </form>
        )}
        {sources.error && <div className="notice error" role="alert">{sources.error}</div>}
        {sources.data && sources.data.length === 0 && <p className="muted">No sources yet.</p>}
        <ul className="list">
          {sources.data?.map((s) => (
            <li key={s.id} className="row between">
              <div>
                <strong>{s.title ?? s.filename ?? "Untitled"}</strong>
                <div className="muted">{[s.year, s.doi && `doi:${s.doi}`, s.page_count && `${s.page_count} pages`, `${s.chunks} passages`].filter(Boolean).join(" · ")}</div>
              </div>
              <span className={`badge ${s.fulltext === "full_text" ? "ok" : s.fulltext === "abstract_only" ? "warn" : ""}`}>{FULLTEXT[s.fulltext] ?? s.fulltext}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="card stack">
        <h2>Research tasks</h2>
        <p className="muted">A task scopes the AI to chosen sources. A lead scientist approves it, which locks those sources.</p>
        {tasks.error && <div className="notice error" role="alert">{tasks.error}</div>}
        <ul className="list">
          {tasks.data?.map((t) => (
            <li key={t.id} className="row between">
              <Link href={`/tasks/${t.id}`}><strong>{t.title}</strong></Link>
              <span className={`badge ${t.status === "draft" ? "warn" : "ok"}`}>{t.status === "draft" ? "Awaiting approval" : "Approved"}</span>
            </li>
          ))}
        </ul>
        <form className="row" onSubmit={newTask}>
          <input type="text" style={{ flex: 1, minWidth: 200 }} placeholder="New task title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} />
          <button type="submit" disabled={busy || !title.trim()}>Create task</button>
        </form>
      </div>
    </div>
  );
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Shell crumbs={<Link href="/">Projects</Link>}><Body id={id} /></Shell>;
}
