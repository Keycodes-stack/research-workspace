"use client";
import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import CommentsPanel from "@/components/CommentsPanel";
import { useLoad } from "@/components/useLoad";
import { useConceptEvents } from "@/lib/useEvents";
import PipelinePanel from "@/components/PipelinePanel";
import SectionEditor, { SECTION_LABEL } from "@/components/SectionEditor";
import { api, currentUserId } from "@/lib/api";
import type { ConceptDetail } from "@/lib/types";

const CRITERIA = ["novelty", "feasibility", "impact", "evidence_strength"];
const DEPTS: Record<string, string> = { rnd: "R&D", finance: "Finance", marketing: "Marketing", legal: "Legal" };
const STATUS_TEXT: Record<string, string> = {
  not_generated: "Not generated yet.", no_evidence: "The sources contain no verifiable statements for this lens.",
  below_similarity_threshold: "Sources are not similar enough to this concept.",
};

function Body({ id }: { id: string }) {
  const c = useLoad<ConceptDetail>(() => api.concept(id), [id]);
  const lenses = useLoad(() => api.lenses(id), [id]);
  const comments = useLoad(() => api.comments(id), [id]);
  const presence = useLoad(() => api.presence(id), [id]);
  const locks = useLoad(() => api.locks(id), [id]);
  const [live, setLive] = useState(false);
  const me = currentUserId();
  const section = useRef<string | null>(null);
  const [dept, setDept] = useState("rnd");

  // Live events carry ids only; refetch what changed. Bursts of events are coalesced so a busy session
  // cannot flood the gateway's per-user rate limit. Reconnects trigger a full resync.
  const pending = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloaders = useRef<Record<string, () => Promise<void>>>({});
  reloaders.current = { section: c.reload, comment: comments.reload, presence: presence.reload, lock: locks.reload };
  useConceptEvents(id, (f) => {
    if (f.event === "resync") Object.keys(reloaders.current).forEach((k) => pending.current.add(k));
    else if (f.event in reloaders.current) pending.current.add(f.event);
    else return;
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const todo = [...pending.current]; pending.current.clear();
      todo.forEach((k) => void reloaders.current[k]());
    }, 400);
  }, setLive);
  // heartbeat keeps us in the "who is here" list
  useEffect(() => {
    const t = setInterval(() => { void api.heartbeat(id, section.current).catch(() => {}); }, 20000);
    void api.heartbeat(id, null).catch(() => {});
    return () => clearInterval(t);
  }, [id]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!c.data) return c.error ? <div className="notice error" role="alert">{c.error}</div> : <p className="muted">Loading…</p>;
  const d = c.data;

  async function gen() {
    setBusy(true); setMsg(null);
    try { await api.generateLenses(id); await lenses.reload(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  }
  async function activate() {
    setMsg(null);
    try { await api.conceptStatus(id, "active"); await c.reload(); } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <div className="stack">
      <div className="nav-back-bar">
        <Link href={`/projects/${d.project_id}/concepts`} className="nav-back-link">
          ← Back to Concepts Hub
        </Link>
        <Link href={`/projects/${d.project_id}/pipeline`} className="nav-back-link">
          📋 Pipeline (Kanban)
        </Link>
        <Link href={`/projects/${d.project_id}/signals`} className="nav-back-link">
          📡 Signal Board
        </Link>
        <Link href={`/projects/${d.project_id}`} className="nav-back-link">
          📂 Project Overview
        </Link>
      </div>

      <div className="card stack">
        <div className="row between"><h1>{d.title}</h1><span className="badge">{d.status}</span></div>
        {d.status === "draft" && <div><button onClick={() => void activate()}>Activate concept</button></div>}
        {msg && <div className="notice error" role="alert">{msg}</div>}
        {c.error && <div className="notice error" role="alert">{c.error}</div>}
        <div className="muted" aria-label="Who is here">
          {live ? "Live" : "Reconnecting…"} · Here now: {(presence.data ?? []).filter((u) => u.user_id !== me).length ? presence.data!.filter((u) => u.user_id !== me).map((u) => u.user_id.slice(0, 8) + (u.section ? ` (${u.section.replace("_", " ")})` : "")).join(", ") : "just you"}
        </div>
      </div>

      <PipelinePanel conceptId={id} onMoved={() => void c.reload()} />

      <div className="card stack">
        <h2>Brief</h2>
        <p className="muted">Written by your team. These sections are not model output and are not source-verified.</p>
        {Object.keys(SECTION_LABEL).map((k) => (
          <SectionEditor key={k} conceptId={id} k={k} initial={d.sections[k].body} version={d.sections[k].version} live={live}
            lockedBy={locks.data?.find((l) => l.section === k && l.user_id !== me)?.user_id.slice(0, 8) ?? null}
            onFocusSection={(s) => { section.current = s; void api.heartbeat(id, s).catch(() => {}); }}
            onSaved={() => void c.reload()} />
        ))}
      </div>

      <CommentsPanel conceptId={id} data={comments.data} onChange={() => void comments.reload()} />

      <div className="card stack">
        <h2>Verified evidence</h2>
        <ul className="list">
          {d.evidence.map((e) => (
            <li key={e.id}>
              <strong>{e.claim_text}</strong>
              <blockquote>“{e.quote}”</blockquote>
              <div className="muted">{e.label}{e.page_start ? `, p.${e.page_start}` : ""} <span className={`badge ${e.intact ? "ok" : "warn"}`}>{e.intact ? "source unchanged" : "SOURCE CHANGED"}</span></div>
            </li>
          ))}
        </ul>
      </div>

      <div className="card stack">
        <h2>Scoring</h2>
        <p><strong>Evidence score: {d.rubric.evidence.score}/100</strong> <span className="muted">
          ({d.rubric.evidence.statements} verified statements, {d.rubric.evidence.sources} sources, {d.rubric.evidence.both_models} found by both models). Computed from the evidence, not opinion.</span></p>
        <table><thead><tr><th>Criterion</th><th>Team average</th><th>Your score (1–5)</th></tr></thead><tbody>
          {CRITERIA.map((k) => (
            <tr key={k}><td>{k.replace("_", " ")}</td>
              <td>{d.rubric.human[k].average ?? "—"} <span className="muted">({d.rubric.human[k].raters})</span></td>
              <td><select aria-label={`Score ${k}`} value={d.rubric.human[k].mine ?? ""}
                onChange={async (e) => { await api.score(id, k, Number(e.target.value)); await c.reload(); }}>
                <option value="" disabled>Choose</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></td></tr>
          ))}
        </tbody></table>
        <p className="muted">{d.rubric.note}</p>
      </div>

      <div className="card stack">
        <h2>Department lenses</h2>
        <p className="muted">Each lens shows only statements quoted from your sources. Lenses never calculate or estimate figures.</p>
        <div><button onClick={() => void gen()} disabled={busy}>{busy ? "Generating…" : "Generate / refresh lenses"}</button></div>
        <div className="row" role="tablist">
          {Object.entries(DEPTS).map(([k, l]) => <button key={k} role="tab" aria-selected={dept === k} className={dept === k ? "" : "secondary"} onClick={() => setDept(k)}>{l}</button>)}
        </div>
        {lenses.data && (lenses.data[dept].items.length === 0
          ? <p className="muted">{STATUS_TEXT[lenses.data[dept].status] ?? lenses.data[dept].status}</p>
          : <ul className="list">{lenses.data[dept].items.map((it) => (
              <li key={it.text}><strong>{it.text}</strong> <span className="badge">{it.models_agree ? "both models" : "one model"}</span>
                {it.evidence.slice(0, 1).map((e, i) => <blockquote key={i}>“{e.quote}” <span className="muted">{e.label}{e.page_start ? `, p.${e.page_start}` : ""}</span>
                  {!e.intact && <span className="badge warn">SOURCE CHANGED</span>}</blockquote>)}
              </li>))}</ul>)}
      </div>
    </div>
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Shell crumbs={<Link href="/">Projects</Link>}><Body id={id} /></Shell>;
}
