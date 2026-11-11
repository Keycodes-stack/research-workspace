"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { EMPTY_FORM, buildExportBody, type ExportForm } from "@/lib/exportForm";

/** Business Case PDF export. The PDF is built on the server from stored, verified answers only. */
export default function ExportPanel({ threadId, disabled }: { threadId: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<ExportForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const set = <K extends keyof ExportForm>(k: K, v: ExportForm[K]) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const built = buildExportBody(f);
    if ("error" in built) { setError(built.error); return; }
    setBusy(true); setError(null); setDone(null);
    try {
      const { blob, filename, fingerprint } = await api.exportBusinessCase(threadId, built.body);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setDone(`Downloaded ${filename}${fingerprint ? ` (fingerprint ${fingerprint.slice(0, 12)}…)` : ""}.`);
    } catch (err) { setError(err instanceof Error ? err.message : "Export failed"); }
    finally { setBusy(false); }
  }

  const text = (label: string, k: keyof ExportForm, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="stack"><span>{label}</span>
      <input type="text" value={f[k] as string} onChange={(e) => set(k, e.target.value as never)} {...props} /></label>
  );

  return (
    <div className="card stack">
      <div className="row between">
        <div>
          <h2 style={{ margin: 0 }}>Business Case report</h2>
          <span className="muted">A formal PDF with the verified findings, citations table, metrics and approval chain.</span>
        </div>
        <button className="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={disabled}>
          {open ? "Close" : "Export PDF"}
        </button>
      </div>
      {open && (
        <form className="stack" onSubmit={submit}>
          <div className="cols">
            {text("Report title (optional)", "title", { maxLength: 200 })}
            {text("Prepared by (optional)", "preparedBy", { maxLength: 200 })}
          </div>
          {text("Organisation (optional)", "organization", { maxLength: 200 })}
          <label className="row"><input type="checkbox" checked={f.includeFinancial} onChange={(e) => set("includeFinancial", e.target.checked)} />
            <span>Include a financial projection</span></label>
          {f.includeFinancial && (
            <fieldset className="stack" style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}>
              <legend>Your assumptions</legend>
              <p className="muted" style={{ margin: 0 }}>These are your own figures. The report labels them as unverified assumptions and only does arithmetic on them.</p>
              <div className="cols">
                {text("Currency", "currency", { maxLength: 8 })}
                {text("Horizon (years, 1–20)", "horizon", { inputMode: "numeric" })}
                {text("Upfront cost", "upfront", { inputMode: "decimal" })}
                {text("Annual benefit (year 1)", "benefit", { inputMode: "decimal" })}
                {text("Annual running cost", "running", { inputMode: "decimal" })}
                {text("Benefit growth per year (%)", "growth", { inputMode: "decimal" })}
                {text("Discount rate (%)", "discount", { inputMode: "decimal" })}
              </div>
              <label className="stack"><span>Note (optional)</span>
                <textarea value={f.note} maxLength={1000} onChange={(e) => set("note", e.target.value)} /></label>
            </fieldset>
          )}
          {error && <div className="notice error" role="alert">{error}</div>}
          {done && <div className="notice" role="status" style={{ background: "var(--ok-bg)", color: "var(--ok)" }}>{done}</div>}
          <div><button type="submit" disabled={busy}>{busy ? "Building report…" : "Download PDF"}</button></div>
        </form>
      )}
    </div>
  );
}
