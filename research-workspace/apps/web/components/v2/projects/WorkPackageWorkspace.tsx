"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import TopBar from "@/components/v2/dashboard/TopBar";
import ProjectsPanel from "@/components/v2/dashboard/ProjectsPanel";
import { ApiError, api } from "@/lib/api";
import { V2 } from "@/lib/v2/routes";

type SaveState = "loading" | "saved" | "dirty" | "saving" | "conflict" | "error";

const AUTOSAVE_MS = 1500;
const STATE_TEXT: Record<SaveState, string> = {
  loading: "Loading…",
  saved: "All changes saved",
  dirty: "Unsaved changes",
  saving: "Saving…",
  conflict: "Changed elsewhere. Reload to see the latest version.",
  error: "Could not save. Your text is still here; try again.",
};

/** The Workspace page of one work package: a plain-text document, saved automatically as you type. */
export default function WorkPackageWorkspace({ projectId, taskId }: { projectId: string; taskId: string }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<SaveState>("loading");
  const [loadError, setLoadError] = useState("");
  const bodyRef = useRef("");
  const versionRef = useRef(0);

  useEffect(() => {
    let live = true;
    api.workPackageDocument(taskId).then((doc) => {
      if (!live) return;
      setTitle(doc.title); setBody(doc.body); bodyRef.current = doc.body;
      setVersion(doc.version); versionRef.current = doc.version; setState("saved");
    }).catch((e) => { if (live) setLoadError(e instanceof Error ? e.message : "Could not load the document."); });
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

  // Autosave: after the user pauses typing, save once.
  useEffect(() => {
    if (state !== "dirty") return;
    const timer = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // save reads refs, so only the typing state needs to restart the timer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, body]);

  const onChange = (value: string) => {
    bodyRef.current = value;
    setBody(value);
    setState("dirty");
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
            <span role="status" aria-live="polite" className={`text-sm ${state === "conflict" || state === "error" ? "text-[#B42318]" : "text-[#667085]"}`}>{STATE_TEXT[state]}</span>
          </div>
          <section className="rounded-[20px] border border-[#EDEDF0] bg-white p-5 sm:p-7">
            <label className="sr-only" htmlFor="wp-document">Document</label>
            <textarea id="wp-document" value={body} onChange={(e) => onChange(e.target.value)} disabled={state === "loading"}
              maxLength={200000} placeholder="Start writing this work package's findings, method and open questions…"
              className="min-h-[60vh] w-full resize-y rounded-[12px] border border-[#EDEDF0] bg-white p-4 text-sm leading-6 text-[#101D37] outline-none focus:border-blue focus:ring-2 focus:ring-blue/10" />
            <div className="mt-2 flex justify-end text-xs text-[#98A2B3]">{body.length.toLocaleString()} / 200,000</div>
          </section>
        </>}
      </main>
    </div>
  </div>;
}
