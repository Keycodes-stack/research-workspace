"use client";
import Link from "next/link";
import { use, useState } from "react";
import Shell from "@/components/Shell";
import ProjectNav from "@/components/ProjectNav";
import { useLoad } from "@/components/useLoad";
import { api } from "@/lib/api";

function Body({ id }: { id: string }) {
  const project = useLoad(() => api.project(id), [id]);
  const concepts = useLoad(() => api.concepts(id), [id]);
  const promoted = useLoad(() => api.signals(id, { status: "promoted" }), [id]);
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try { const c = await api.createConcept(id, title.trim(), [...picked]); window.location.assign(`/concepts/${c.id}`); }
    catch (x) { setErr(x instanceof Error ? x.message : "Could not create concept"); }
  }

  return (
    <div className="stack">
      <ProjectNav
        projectId={id}
        activeTab="concepts"
        projectName={project.data?.name}
        role={project.data?.role}
      />
      <div className="card stack">
        <h1>Concepts</h1>
        {concepts.error && <div className="notice error" role="alert">{concepts.error}</div>}
        {concepts.data?.length === 0 && <p className="muted">No concepts yet. Promote signals on the Signal board, then build a concept from them.</p>}
        <ul className="list">
          {concepts.data?.map((c) => (
            <li key={c.id} className="row between">
              <Link href={`/concepts/${c.id}`}><strong>{c.title}</strong></Link>
              <span className="muted">{c.evidence} verified passages · {c.status}</span>
            </li>
          ))}
        </ul>
      </div>
      <form className="card stack" onSubmit={create}>
        <h2>New concept from promoted signals</h2>
        {promoted.data?.length === 0 && <p className="muted">No promoted signals. <Link href={`/projects/${id}/signals`}>Open the Signal board</Link>.</p>}
        {promoted.data?.map((s) => (
          <label key={s.id} className="row">
            <input type="checkbox" checked={picked.has(s.id)}
              onChange={() => setPicked((p) => { const n = new Set(p); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n; })} />
            <span><span className="badge">{s.category}</span> {s.text}</span>
          </label>
        ))}
        <input type="text" placeholder="Concept title" value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} required aria-label="Concept title" />
        {err && <div className="notice error" role="alert">{err}</div>}
        <div><button type="submit" disabled={title.trim().length < 3 || picked.size === 0}>Create concept</button></div>
      </form>
    </div>
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Shell crumbs={<><Link href="/">Projects</Link> / <Link href={`/projects/${id}`}>Project</Link></>}><Body id={id} /></Shell>;
}
