"use client";
import Link from "next/link";
import { use, useState } from "react";
import Shell from "@/components/Shell";
import ProjectNav from "@/components/ProjectNav";
import { useLoad } from "@/components/useLoad";
import { api } from "@/lib/api";
import type { Signal, SignalCategory, SignalDetail } from "@/lib/types";

const CATS: { key: SignalCategory | ""; label: string }[] = [
  { key: "", label: "All" }, { key: "trend", label: "Trends" }, { key: "opportunity", label: "Opportunities" }, { key: "risk", label: "Risks" },
];
const CONF_NOTE: Record<string, string> = {
  high: "Both models found it, in 2+ sources", medium: "Both models, or 2+ sources", low: "One model, one source",
};

function Evidence({ id }: { id: string }) {
  const d = useLoad<SignalDetail>(() => api.signal(id), [id]);
  if (d.error) return <div className="notice error" role="alert">{d.error}</div>;
  if (!d.data) return <p className="muted">Loading evidence…</p>;
  return (
    <ul className="list">
      {d.data.evidence.map((e) => (
        <li key={e.id}>
          <blockquote>“{e.quote}”</blockquote>
          <div className="muted">
            {e.label}{e.page_start ? `, p.${e.page_start}` : ""} · found by {e.model === "model_a" ? "Model A" : "Model B"} · match: {e.match_kind}
            {" "}<span className={`badge ${e.intact ? "ok" : "warn"}`}>{e.intact ? "source unchanged" : "SOURCE CHANGED, do not rely"}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Card({ s, onChange }: { s: Signal; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<"dismiss" | "promote" | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function act(action: "dismiss" | "promote" | "restore") {
    setErr(null);
    try { await api.signalAction(s.id, action, action === "restore" ? undefined : { reason }); setAsking(null); setReason(""); onChange(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <li className="card stack" data-testid="signal">
      <div className="row between">
        <span className="badge">{s.category}</span>
        <span className={`badge ${s.confidence === "high" ? "ok" : s.confidence === "low" ? "warn" : ""}`} title={CONF_NOTE[s.confidence]}>
          {s.confidence} confidence
        </span>
      </div>
      <p><strong>{s.text}</strong></p>
      <div className="muted">{s.models_agree ? "Both models" : "One model"} · {s.source_count} source{s.source_count === 1 ? "" : "s"}{s.status !== "new" && ` · ${s.status}`}</div>
      <div className="row">
        <button className="secondary" onClick={() => setOpen(!open)}>{open ? "Hide evidence" : "Show evidence"}</button>
        {s.status === "new" && <>
          <button onClick={() => setAsking("promote")}>Promote</button>
          <button className="secondary" onClick={() => setAsking("dismiss")}>Dismiss</button>
        </>}
        {(s.status === "dismissed" || s.status === "promoted") && <button className="secondary" onClick={() => void act("restore")}>Restore</button>}
      </div>
      {asking && (
        <form className="row" onSubmit={(e) => { e.preventDefault(); void act(asking); }}>
          <input style={{ flex: 1 }} placeholder={asking === "promote" ? "Why is this worth pursuing?" : "Why dismiss?"}
            value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} required aria-label="Reason" />
          <button type="submit" disabled={reason.trim().length < 3}>Confirm {asking}</button>
          <button type="button" className="secondary" onClick={() => setAsking(null)}>Cancel</button>
        </form>
      )}
      {err && <div className="notice error" role="alert">{err}</div>}
      {open && <Evidence id={s.id} />}
    </li>
  );
}

function Body({ id }: { id: string }) {
  const project = useLoad(() => api.project(id), [id]);
  const [cat, setCat] = useState<SignalCategory | "">("");
  const [status, setStatus] = useState("new");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useLoad(() => api.signals(id, { category: cat, status }), [id, cat, status]);

  async function scan() {
    setBusy(true); setMsg(null);
    try {
      const r = await api.scanSignals(id, ["trend", "opportunity", "risk"]);
      const skipped = r.skipped.map((x) => `${x.category}: ${x.reason.replace(/_/g, " ")}`);
      setMsg({ kind: "ok", text: `${r.created} new, ${r.already_known} already known.${skipped.length ? " Skipped: " + skipped.join(", ") : ""}` });
      await list.reload();
    } catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Scan failed" }); }
    finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <ProjectNav
        projectId={id}
        activeTab="signals"
        projectName={project.data?.name}
        role={project.data?.role}
      />
      <div className="card stack">
        <h1>Signal board</h1>
        <p className="muted">Trends, opportunities and risks found in your sources. Every signal is a quote-verified claim; nothing is shown that could not be traced to a passage.</p>
        <div><button onClick={() => void scan()} disabled={busy}>{busy ? "Scanning…" : "Scan sources for signals"}</button></div>
        {msg && <div className={`notice ${msg.kind === "error" ? "error" : ""}`} role="status">{msg.text}</div>}
        <div className="row" role="tablist">
          {CATS.map((c) => <button key={c.key} role="tab" aria-selected={cat === c.key} className={cat === c.key ? "" : "secondary"} onClick={() => setCat(c.key)}>{c.label}</button>)}
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="new">New</option><option value="promoted">Promoted</option><option value="dismissed">Dismissed</option><option value="merged">Merged</option><option value="">All</option>
          </select>
        </div>
      </div>
      {list.error && <div className="notice error" role="alert">{list.error}</div>}
      {list.data && list.data.length === 0 && <p className="muted">No signals here. Scan your sources to find some.</p>}
      <ul className="list stack">{list.data?.map((s) => <Card key={s.id} s={s} onChange={() => void list.reload()} />)}</ul>
    </div>
  );
}

export default function SignalsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Shell crumbs={<><Link href="/">Projects</Link> / <Link href={`/projects/${id}`}>Project</Link></>}><Body id={id} /></Shell>;
}
