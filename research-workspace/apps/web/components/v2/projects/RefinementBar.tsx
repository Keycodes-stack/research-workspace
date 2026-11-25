"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { RefineProposal } from "@/lib/types";

/*
 * Refinement bar: a plain-language request becomes proposed changes. Nothing is written until "Apply".
 */
const FIELD_LABEL: Record<string, string> = {
  name: "Project name", lead: "Lead", priority: "Priority", title: "Title", due_date: "Due date",
};

export default function RefinementBar({ projectId, onApplied }: { projectId: string; onApplied: () => void }) {
  const [text, setText] = useState("");
  const [proposal, setProposal] = useState<RefineProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const suggest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    setProposal(null);
    try {
      const result = await api.refinePropose(projectId, text.trim());
      if (result.changes.length === 0) setNote(result.reply || "No change could be made from that request.");
      else setProposal(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not get a suggestion.");
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!proposal || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.refineApply(projectId, proposal.changes);
      setNote(`Applied ${result.applied} change${result.applied === 1 ? "" : "s"}.`);
      setProposal(null);
      setText("");
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The changes could not be saved. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  };

  const discard = () => {
    setProposal(null);
    setNote(null);
  };

  return (
    <div aria-label="Refinement bar" className="sticky bottom-0 z-10 -mx-4 border-t border-[#EDEDF0] bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      {proposal && (
        <div className="mb-2 rounded-xl border border-[#EDEDF0] bg-[#FAFAFA] p-3">
          <p className="text-sm text-[#101D37]">{proposal.reply}</p>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-[#344054]">
            {proposal.changes.map((c, i) => (
              <li key={i}>
                {c.target === "work_package" ? "Work package: " : ""}{FIELD_LABEL[c.field] ?? c.field}:{" "}
                <span className="text-body">{c.from || "empty"}</span> → <span className="font-medium text-[#101D37]">{c.value}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => void apply()} disabled={busy}
              className="rounded-[10px] bg-blue px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">Apply</button>
            <button type="button" onClick={discard} disabled={busy}
              className="rounded-[10px] border border-[#EDEDF0] bg-white px-3 py-1.5 text-xs font-semibold text-[#344054]">Discard</button>
          </div>
        </div>
      )}
      {note && <p role="status" className="mb-2 text-sm text-[#344054]">{note}</p>}
      {error && <p role="alert" className="mb-2 text-sm text-[#B42318]">{error}</p>}
      <form onSubmit={suggest} className="flex gap-2">
        <input
          aria-label="Describe a change"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={1000}
          placeholder='For example: "Make Sara Chen the lead" or "Set the Pilot study due date to 2026-12-31"'
          className="h-10 min-w-0 flex-1 rounded-[10px] border border-[#EDEDF0] bg-white px-3 text-sm text-[#101D37] outline-none focus:border-blue"
        />
        <button type="submit" disabled={busy || !text.trim()}
          className="h-10 rounded-[10px] bg-blue px-4 text-sm font-semibold text-white disabled:opacity-60">
          {busy ? "Thinking…" : "Suggest"}
        </button>
      </form>
    </div>
  );
}
