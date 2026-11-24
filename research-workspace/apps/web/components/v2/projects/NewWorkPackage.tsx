"use client";

import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";

/** "+ New work package": a title and a brief. The package gets its code, its Workspace document and its evidence research. */
export default function NewWorkPackage({ projectId, onCreated }: { projectId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => { setOpen(false); setTitle(""); setBrief(""); setError(null); };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!title.trim()) { setError("Give the work package a title."); return; }
    setBusy(true);
    setError(null);
    try {
      await api.createWorkPackage(projectId, { title: title.trim(), brief: brief.trim() || undefined });
      close();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the work package.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-[10px] bg-blue px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
        + New work package
      </button>
    );
  }

  return (
    <form onSubmit={submit} aria-label="New work package"
      className="mt-4 flex w-full flex-col gap-3 rounded-2xl border border-[#EDEDF0] bg-[#FAFAFA] p-4">
      <label className="flex flex-col gap-1 text-sm text-[#344054]">
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} required
          className="h-10 rounded-[10px] border border-[#EDEDF0] bg-white px-3 text-sm text-[#101D37] outline-none focus:border-blue" />
      </label>
      <label className="flex flex-col gap-1 text-sm text-[#344054]">
        Brief (optional)
        <textarea value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={10000} rows={3}
          className="rounded-[10px] border border-[#EDEDF0] bg-white px-3 py-2 text-sm text-[#101D37] outline-none focus:border-blue" />
      </label>
      {error && <p role="alert" className="text-sm text-[#B42318]">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={close} disabled={busy}
          className="rounded-[10px] border border-[#EDEDF0] bg-white px-4 py-2 text-sm font-medium text-[#344054]">Cancel</button>
        <button type="submit" disabled={busy}
          className="rounded-[10px] bg-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {busy ? "Creating…" : "Create work package"}
        </button>
      </div>
    </form>
  );
}
