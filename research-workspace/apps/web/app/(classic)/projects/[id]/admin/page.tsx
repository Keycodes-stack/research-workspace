"use client";
import Link from "next/link";
import { use, useState } from "react";
import Shell from "@/components/Shell";
import ProjectNav from "@/components/ProjectNav";
import { useLoad } from "@/components/useLoad";
import { api } from "@/lib/api";

const ROLES = ["viewer", "researcher", "lead_scientist", "admin", "owner"];
const label = (r: string) => r.replace("_", " ");

function Members({ id }: { id: string }) {
  const m = useLoad(() => api.members(id), [id]);
  const [uid, setUid] = useState("");
  const [role, setRole] = useState("researcher");
  const [err, setErr] = useState<string | null>(null);
  async function run(f: () => Promise<unknown>) {
    setErr(null);
    try { await f(); await m.reload(); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
  }
  return (
    <div className="card stack">
      <h2>Members and roles</h2>
      {m.data && <p className="muted">Your role: <strong>{label(m.data.you)}</strong></p>}
      <table><thead><tr><th>User ID</th><th>Role</th><th /></tr></thead><tbody>
        {m.data?.members.map((x) => (
          <tr key={x.user_id}><td><code>{x.user_id}</code></td>
            <td><select aria-label={`Role for ${x.user_id}`} value={x.role} onChange={(e) => void run(() => api.setRole(id, x.user_id, e.target.value))}>
              {ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}</select></td>
            <td><button className="secondary" onClick={() => void run(() => api.removeMember(id, x.user_id))}>Remove</button></td></tr>
        ))}
      </tbody></table>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void run(() => api.addMember(id, uid.trim(), role)).then(() => setUid("")); }}>
        <input style={{ flex: 1, minWidth: 260 }} placeholder="User ID (UUID from your identity system)" value={uid} onChange={(e) => setUid(e.target.value)} aria-label="User ID" />
        <select aria-label="New member role" value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}</select>
        <button type="submit" disabled={uid.trim().length < 36}>Add member</button>
      </form>
      {err && <div className="notice error" role="alert">{err}</div>}
      <details><summary>What each role can do</summary>
        <ul className="list">{m.data?.permissions.map((p) => <li key={p.min_role}><strong>{label(p.min_role)}</strong>: {p.capability}</li>)}</ul></details>
    </div>
  );
}

function Usage({ id }: { id: string }) {
  const u = useLoad(() => api.usage(id), [id]);
  const [val, setVal] = useState("");
  const [err, setErr] = useState<string | null>(null);
  async function save(v: number | null) {
    setErr(null);
    try { await api.setBudget(id, v); await u.reload(); setVal(""); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
  }
  return (
    <div className="card stack">
      <h2>Usage and budget</h2>
      {u.error && <div className="notice error" role="alert">{u.error}</div>}
      {u.data && <>
        <p><strong>{u.data.month_calls}</strong> model calls this month{u.data.monthly_call_budget !== null
          ? <> of a <strong>{u.data.monthly_call_budget}</strong> budget ({u.data.remaining} left)</> : <> (no budget set)</>}</p>
        <table><thead><tr><th>Activity</th><th>Operations</th><th>Model calls</th></tr></thead><tbody>
          {u.data.by_kind.map((k) => <tr key={k.kind}><td>{k.kind}</td><td>{k.operations}</td><td>{k.model_calls}</td></tr>)}</tbody></table>
        <form className="row" onSubmit={(e) => { e.preventDefault(); void save(Number(val)); }}>
          <input type="number" min={0} placeholder="Monthly model-call budget" value={val} onChange={(e) => setVal(e.target.value)} aria-label="Monthly budget" />
          <button type="submit" disabled={val === ""}>Set budget</button>
          <button type="button" className="secondary" onClick={() => void save(null)}>Remove budget</button>
        </form>
        <p className="muted">{u.data.note}</p>
      </>}
      {err && <div className="notice error" role="alert">{err}</div>}
    </div>
  );
}

function Audit({ id }: { id: string }) {
  const [action, setAction] = useState("");
  const [extra, setExtra] = useState<Awaited<ReturnType<typeof api.audit>>["entries"]>([]);
  const a = useLoad(() => api.audit(id, { action }), [id, action]);
  const next = a.data?.next_before ?? null;
  const all = [...(a.data?.entries ?? []), ...extra];
  return (
    <div className="card stack">
      <h2>Audit log</h2>
      <p className="muted">Every consequential action, who did it and when. Entries cannot be edited or deleted.</p>
      <input placeholder="Filter by action, e.g. task.approve" value={action} onChange={(e) => { setAction(e.target.value); setExtra([]); }} aria-label="Filter action" />
      {a.error && <div className="notice error" role="alert">{a.error}</div>}
      <table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead><tbody>
        {all.map((e) => (
          <tr key={e.id}><td>{new Date(e.created_at).toLocaleString()}</td><td><code>{e.actor.slice(0, 8)}</code></td><td>{e.action}</td>
            <td className="muted">{Object.entries(e.detail).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ")}</td></tr>
        ))}</tbody></table>
      {all.length === 0 && a.data && <p className="muted">No entries.</p>}
      {next !== null && extra.length === 0 && <div><button className="secondary" onClick={async () => { const r = await api.audit(id, { action, before: next }); setExtra(r.entries); }}>Load older</button></div>}
    </div>
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const project = useLoad(() => api.project(id), [id]);
  return (
    <Shell crumbs={<><Link href="/">Projects</Link> / <Link href={`/projects/${id}`}>Project</Link></>}>
      <div className="stack">
        <ProjectNav
          projectId={id}
          activeTab="admin"
          projectName={project.data?.name}
          role={project.data?.role}
        />
        <Members id={id} />
        <Usage id={id} />
        <Audit id={id} />
      </div>
    </Shell>
  );
}
