"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import TopBar from "@/components/v2/dashboard/TopBar";
import ProjectsPanel from "@/components/v2/dashboard/ProjectsPanel";
import RichEditor, { commentIdsIn, toEditorContent, type EditorApi } from "@/components/v2/projects/RichEditor";
import { ApiError, api, currentUserId } from "@/lib/api";
import type { WorkPackageComment } from "@/lib/types";
import { V2 } from "@/lib/v2/routes";

type SaveState = "loading" | "saved" | "dirty" | "saving" | "conflict" | "error";

const AUTOSAVE_MS = 1500;
const STATE_TEXT: Record<SaveState, string> = {
  loading: "Loading…",
  saved: "All changes saved",
  dirty: "Unsaved changes",
  saving: "Saving…",
  conflict: "Changed elsewhere. Reload to see the latest version.",
  error: "Could not save. Your changes are still here; try again.",
};

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * The Workspace page of one work package: a Word-style document with anchored comments (as in Google Docs).
 * A comment belongs to the selected text; replies, resolve and reopen work on the thread; if the commented text is
 * deleted, the thread stays in the panel and says so.
 */
export default function WorkPackageWorkspace({ projectId, taskId }: { projectId: string; taskId: string }) {
  const [title, setTitle] = useState("");
  const [initial, setInitial] = useState<Record<string, unknown> | null>(null);
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<SaveState>("loading");
  const [loadError, setLoadError] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [comments, setComments] = useState<WorkPackageComment[]>([]);
  const [docCommentIds, setDocCommentIds] = useState<Set<string>>(new Set());
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [commentError, setCommentError] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const bodyRef = useRef("");
  const versionRef = useRef(0);
  const editorApi = useRef<EditorApi | null>(null);
  const me = currentUserId();

  const download = () => {
    setDownloadError("");
    api.downloadWorkPackageDocument(taskId).catch((e) => setDownloadError(e instanceof Error ? e.message : "Could not create the Word document."));
  };

  useEffect(() => {
    let live = true;
    api.workPackageDocument(taskId).then((doc) => {
      if (!live) return;
      setTitle(doc.title);
      setInitial(toEditorContent(doc.format, doc.body));
      bodyRef.current = doc.body;
      setDocCommentIds(commentIdsIn(doc.body));
      setVersion(doc.version); versionRef.current = doc.version; setState("saved");
    }).catch((e) => { if (live) setLoadError(e instanceof Error ? e.message : "Could not load the document."); });
    api.workPackageComments(taskId).then((rows) => { if (live) setComments(rows); }).catch(() => { if (live) setComments([]); });
    return () => { live = false; };
  }, [taskId]);

  const save = async () => {
    const sent = bodyRef.current;
    setState("saving");
    try {
      const res = await api.saveWorkPackageDocument(taskId, sent, versionRef.current);
      versionRef.current = res.version; setVersion(res.version);
      // Typing continued while the request was in flight: keep the document marked as unsaved.
      setState(bodyRef.current === sent ? "saved" : "dirty");
    } catch (e) {
      setState(e instanceof ApiError && e.status === 409 ? "conflict" : "error");
    }
  };

  // Autosave: once the user pauses, save the document.
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (state !== "dirty") return;
    const timer = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // save reads refs; the timer restarts on each change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, pending]);

  const onChange = (json: string) => {
    bodyRef.current = json;
    setDocCommentIds(commentIdsIn(json));
    setPending((n) => n + 1);
    setState("dirty");
  };

  const reloadComments = async () => setComments(await api.workPackageComments(taskId));

  /** Post a new comment on the selected text, then anchor it in the document (the document then autosaves). */
  const postNewComment = async () => {
    const text = newComment.trim();
    if (!text || pendingText === null) return;
    setCommentError("");
    try {
      const created = await api.addWorkPackageComment(taskId, text, pendingText);
      editorApi.current?.addCommentAnchor(created.id);
      setNewComment(""); setPendingText(null);
      await reloadComments();
    } catch (e) {
      setCommentError(e instanceof Error ? e.message : "Could not add the comment.");
    }
  };

  const postReply = async (parent: WorkPackageComment) => {
    const text = replyText.trim();
    if (!text) return;
    setCommentError("");
    try {
      await api.addWorkPackageComment(taskId, text, undefined, parent.id);
      setReplyText(""); setReplyTo(null);
      await reloadComments();
    } catch (e) {
      setCommentError(e instanceof Error ? e.message : "Could not add the reply.");
    }
  };

  const setResolved = async (comment: WorkPackageComment, resolved: boolean) => {
    setCommentError("");
    try {
      await api.resolveWorkPackageComment(taskId, comment.id, resolved);
      await reloadComments();
    } catch (e) {
      setCommentError(e instanceof Error ? e.message : "Could not update the comment.");
    }
  };

  const remove = async (comment: WorkPackageComment) => {
    if (!window.confirm("Delete this comment and its replies?")) return;
    setCommentError("");
    try {
      await api.deleteWorkPackageComment(taskId, comment.id);
      if (comment.parent_id === null) editorApi.current?.removeCommentAnchor(comment.id);
      await reloadComments();
    } catch (e) {
      setCommentError(e instanceof Error ? e.message : "The comment could not be deleted.");
    }
  };

  const threads = useMemo(() => comments.filter((c) => c.parent_id === null), [comments]);
  const repliesOf = (id: string) => comments.filter((c) => c.parent_id === id);
  const resolvedIds = useMemo(() => threads.filter((t) => t.resolved).map((t) => t.id), [threads]);
  const openThreads = threads.filter((t) => !t.resolved);
  const closedThreads = threads.filter((t) => t.resolved);

  const renderThread = (t: WorkPackageComment) => {
    const anchored = docCommentIds.has(t.id);
    const orphaned = !!t.anchor_text && !anchored;
    return <li key={t.id} className={`rounded-[12px] border p-3 text-sm ${t.resolved ? "border-[#EDEDF0] bg-[#FAFAFA] text-[#667085]" : "border-[#EDEDF0] text-[#344054]"}`}>
      {t.anchor_text && <blockquote className="mb-2 border-l-2 border-[#FEC84B] pl-2 text-xs text-[#667085]">“{t.anchor_text}”</blockquote>}
      {orphaned && <p className="mb-2 text-xs font-medium text-[#B54708]">The text this comment was about has been deleted.</p>}
      <p className="whitespace-pre-line">{t.body}</p>
      <p className="mt-1 text-xs text-[#98A2B3]">{when(t.created_at)}{t.resolved && t.resolved_at ? ` · resolved ${when(t.resolved_at)}` : ""}</p>
      {repliesOf(t.id).map((r) => <div key={r.id} className="mt-2 border-t border-[#EDEDF0] pt-2">
        <p className="whitespace-pre-line">{r.body}</p>
        <p className="mt-1 text-xs text-[#98A2B3]">{when(r.created_at)}</p>
        {me && r.author === me && <button type="button" onClick={() => void remove(r)} className="mt-1 text-xs font-semibold text-[#B42318]">Delete reply</button>}
      </div>)}
      {replyTo === t.id ? <div className="mt-2 flex flex-col gap-2">
        <textarea aria-label="Reply" value={replyText} onChange={(e) => setReplyText(e.target.value)} rows={2} maxLength={4000}
          className="w-full rounded-[10px] border border-[#EDEDF0] px-3 py-2 text-sm text-[#101D37] outline-none focus:border-blue" />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setReplyTo(null)} className="text-xs font-semibold text-[#667085]">Cancel</button>
          <button type="button" onClick={() => void postReply(t)} disabled={!replyText.trim()} className="rounded-[8px] bg-blue px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">Reply</button>
        </div>
      </div> : null}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-semibold">
        {anchored && <button type="button" onClick={() => editorApi.current?.focusComment(t.id)} className="text-blue">Show in document</button>}
        <button type="button" onClick={() => { setReplyTo(t.id); setReplyText(""); }} className="text-blue">Reply</button>
        <button type="button" onClick={() => void setResolved(t, !t.resolved)} className="text-[#344054]">{t.resolved ? "Reopen" : "Resolve"}</button>
        {me && t.author === me && <button type="button" onClick={() => void remove(t)} className="text-[#B42318]">Delete</button>}
      </div>
    </li>;
  };

  return <div className="flex min-w-0 flex-1">
    <ProjectsPanel activeId={projectId} showWorkPackages activeSection="workspace" />
    <div className="flex min-w-0 flex-1 flex-col">
      <TopBar current="Workspace" trail={[{ label: "Projects", href: `${V2}/projects` }, { label: "Overview", href: `${V2}/projects/${projectId}` }]} />
      <main className="flex flex-col gap-5 px-4 pt-8 pb-16 sm:px-6 lg:px-10">
        {loadError ? <p role="alert" className="text-sm text-[#B42318]">{loadError}</p> : <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Link href={`${V2}/projects/${projectId}`} className="text-sm font-medium text-blue">← Overview</Link>
              <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-[#101D37] sm:text-3xl">{title || "Work package"}</h1>
              <p className="mt-1 text-sm text-[#667085]">Working document · version {version}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-3">
                <span role="status" aria-live="polite" className={`text-sm ${state === "conflict" || state === "error" ? "text-[#B42318]" : "text-[#667085]"}`}>{STATE_TEXT[state]}</span>
                <button type="button" onClick={download} disabled={state === "loading"} className="rounded-[10px] border border-[#EDEDF0] bg-white px-4 py-2 text-sm font-semibold text-[#101D37] disabled:opacity-50">Download Word</button>
              </div>
              {downloadError && <p role="alert" className="text-xs text-[#B42318]">{downloadError}</p>}
            </div>
          </div>
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <section className="rounded-[20px] border border-[#EDEDF0] bg-white p-5 sm:p-7">
              {initial && <RichEditor initial={initial} onChange={onChange} disabled={state === "loading"}
                onCommentRequest={(text) => { setPendingText(text); setNewComment(""); setCommentError(""); }}
                onReady={(api) => { editorApi.current = api; }} resolvedIds={resolvedIds} />}
            </section>
            <aside aria-label="Comments" className="flex flex-col gap-3 rounded-[20px] border border-[#EDEDF0] bg-white p-5">
              <h2 className="font-semibold text-[#101D37]">Comments</h2>
              {pendingText !== null && <div className="flex flex-col gap-2 rounded-[12px] border border-blue/30 bg-blue/[0.03] p-3">
                <blockquote className="border-l-2 border-[#FEC84B] pl-2 text-xs text-[#667085]">“{pendingText}”</blockquote>
                <textarea aria-label="New comment" value={newComment} onChange={(e) => setNewComment(e.target.value)} rows={3} maxLength={4000} placeholder="Add a comment on this text…"
                  className="w-full rounded-[10px] border border-[#EDEDF0] bg-white px-3 py-2 text-sm text-[#101D37] outline-none focus:border-blue" />
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setPendingText(null)} className="text-xs font-semibold text-[#667085]">Cancel</button>
                  <button type="button" onClick={() => void postNewComment()} disabled={!newComment.trim()} className="rounded-[8px] bg-blue px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">Comment</button>
                </div>
              </div>}
              {openThreads.length === 0 && closedThreads.length === 0 && pendingText === null && <p className="text-sm text-[#667085]">Select text in the document and choose Comment.</p>}
              <ul className="flex flex-col gap-3">{openThreads.map(renderThread)}</ul>
              {closedThreads.length > 0 && <>
                <button type="button" onClick={() => setShowResolved((v) => !v)} aria-expanded={showResolved} className="self-start text-xs font-semibold text-blue">
                  {showResolved ? "Hide" : "Show"} {closedThreads.length} resolved
                </button>
                {showResolved && <ul className="flex flex-col gap-3">{closedThreads.map(renderThread)}</ul>}
              </>}
              {commentError && <p role="alert" className="text-xs text-[#B42318]">{commentError}</p>}
            </aside>
          </div>
        </>}
      </main>
    </div>
  </div>;
}
