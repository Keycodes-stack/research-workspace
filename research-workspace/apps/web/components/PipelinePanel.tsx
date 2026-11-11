"use client";
import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useLoad } from "@/components/useLoad";
import type { PipelineGate } from "@/lib/types";

export const STAGE_LABEL: Record<string, string> = {
  ideation: "Ideation", evaluation: "Evaluation", validation: "Validation", pilot: "Pilot", launched: "Launched", parked: "Parked", rejected: "Rejected",
};

export default function PipelinePanel({ conceptId, onMoved }: { conceptId: string; onMoved?: () => void }) {
  const gates = useLoad(() => api.gates(conceptId), [conceptId]);
  const log = useLoad(() => api.decisions(conceptId), [conceptId]);
  const [action, setAction] = useState("advance");
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [failed, setFailed] = useState<PipelineGate[] | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try {
      await api.decide(conceptId, action, reason.trim(), override);
      setReason(""); setOverride(false); setFailed(null);
      await Promise.all([gates.reload(), log.reload()]); onMoved?.();
    } catch (x) {
      if (x instanceof ApiError && x.code === "gate_failed") setFailed((x.detail as { gates: PipelineGate[] }).gates);
      setErr(x instanceof Error ? x.message : "Failed");
    }
  }
  const shown = failed ?? gates.data?.gates ?? [];
  const blockedForever = shown.some((g) => !g.passed && !g.overridable);
  const canOverride = action === "advance" && shown.some((g) => !g.passed) && !blockedForever;

  return (
    <div className="card stack">
      <h2>Pipeline</h2>
      {gates.data && <p>Current stage: <strong>{STAGE_LABEL[gates.data.stage]}</strong>{gates.data.next && <> · next: {STAGE_LABEL[gates.data.next]}</>}</p>}
      {gates.data?.next && (
        <ul className="list" aria-label="Gates">
          {shown.map((g) => (
            <li key={g.name}><span className={`badge ${g.passed ? "ok" : "warn"}`}>{g.passed ? "pass" : "fail"}</span> {g.name}
              <span className="muted"> — {g.detail}{!g.passed && !g.overridable ? " (cannot be overridden)" : ""}</span></li>
          ))}
        </ul>
      )}
      <form className="stack" onSubmit={submit}>
        <div className="row">
          <select aria-label="Decision" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="advance">Advance</option><option value="park">Park</option><option value="reject">Reject</option><option value="reopen">Reopen</option>
          </select>
          <input style={{ flex: 1 }} placeholder="Reason for this decision (min 10 characters)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
          <button type="submit" disabled={reason.trim().length < 10}>Record decision</button>
        </div>
        {canOverride && (
          <label className="row"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            Override failed gates (reason of 30+ characters; recorded permanently)</label>
        )}
        {err && <div className="notice error" role="alert">{err}</div>}
      </form>
      <h3>Decision log</h3>
      {log.data?.length === 0 && <p className="muted">No decisions yet.</p>}
      <ol className="list">
        {log.data?.map((d) => (
          <li key={d.id}><strong>{d.action}</strong>: {STAGE_LABEL[d.from_stage]} → {STAGE_LABEL[d.to_stage]}{d.override && <span className="badge warn">gate override</span>}
            <div>{d.reason}</div><div className="muted">{new Date(d.created_at).toLocaleString()}</div></li>
        ))}
      </ol>
    </div>
  );
}
