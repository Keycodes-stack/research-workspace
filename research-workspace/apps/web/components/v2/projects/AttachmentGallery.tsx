"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { AttachmentRow } from "@/lib/types";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

/** Images attached to a project: thumbnails, add, open and remove. Files are fetched with the user's token. */
export default function AttachmentGallery({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<AttachmentRow[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setItems(await api.listProjectAttachments(projectId));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the attachments.");
    }
  };

  useEffect(() => { void load(); }, [projectId]);

  // One object URL per image; all are released when the list changes or the page closes.
  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    (async () => {
      const next: Record<string, string> = {};
      for (const item of items) {
        try {
          const url = await api.attachmentUrl(item.id);
          if (cancelled) { URL.revokeObjectURL(url); break; }
          next[item.id] = url; created.push(url);
        } catch { /* shown without a preview */ }
      }
      if (!cancelled) setUrls(next);
    })();
    return () => { cancelled = true; created.forEach((u) => URL.revokeObjectURL(u)); };
  }, [items]);

  const add = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true); setError("");
    const problems: string[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) { problems.push(`${file.name} is larger than 10 MB`); continue; }
      try { await api.uploadProjectAttachment(projectId, file); }
      catch (e) { problems.push(e instanceof ApiError || e instanceof Error ? `${file.name}: ${e.message}` : file.name); }
    }
    if (problems.length) setError(problems.join(". "));
    await load();
    setBusy(false);
  };

  const remove = async (item: AttachmentRow) => {
    if (!window.confirm(`Remove ${item.filename}?`)) return;
    try { await api.deleteAttachment(item.id); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "The image could not be removed."); }
  };

  return <section aria-label="Attachments" className="rounded-[20px] border border-[#EDEDF0] bg-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-[#101D37]">Attachments</h2>
        <p className="mt-1 text-sm text-[#667085]">Images for this project: PNG, JPEG, GIF or WebP, up to 10 MB each.</p>
      </div>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-[10px] border border-[#EDEDF0] bg-white px-3 py-2 text-sm font-semibold text-[#101D37]">
        {busy ? "Uploading…" : "Add image"}
        <input type="file" accept={ACCEPT} multiple className="sr-only" disabled={busy} onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
      </label>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-[#B42318]">{error}</p>}
    {items.length === 0 ? <p className="mt-4 text-sm text-[#667085]">No images yet.</p> : <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => <li key={item.id} className="flex flex-col gap-2 rounded-[12px] border border-[#EDEDF0] p-3">
        {urls[item.id]
          ? <a href={urls[item.id]} target="_blank" rel="noreferrer"><img src={urls[item.id]} alt={item.filename} className="h-40 w-full rounded-[8px] object-cover" /></a>
          : <div className="flex h-40 items-center justify-center rounded-[8px] bg-[#F2F4F7] text-sm text-[#667085]">Preview unavailable</div>}
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate font-medium text-[#101D37]" title={item.filename}>{item.filename}</span>
          <span className="shrink-0 text-xs text-[#667085]">{Math.max(1, Math.round(item.size_bytes / 1024))} KB</span>
        </div>
        <button type="button" onClick={() => void remove(item)} className="self-start text-sm font-semibold text-[#B42318]">Remove</button>
      </li>)}
    </ul>}
  </section>;
}
