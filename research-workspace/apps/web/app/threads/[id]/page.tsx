"use client";
import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import AnswerView from "@/components/AnswerView";
import ExportPanel from "@/components/ExportPanel";
import Shell from "@/components/Shell";
import { useLoad } from "@/components/useLoad";
import { ApiError, api } from "@/lib/api";
import type { AskResult, Message } from "@/lib/types";

function Body({ id }: { id: string }) {
  const history = useLoad(() => api.messages(id), [id]);
  const threadInfo = useLoad(() => api.thread(id), [id]);
  const [local, setLocal] = useState<{ q: string; result?: AskResult; error?: string }[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView?.({ behavior: "smooth" }); }, [history.data, local]);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (q.length < 3) return;
    setBusy(true); setQuestion("");
    setLocal((l) => [...l, { q }]);
    try {
      const result = await api.ask(id, q);
      setLocal((l) => l.map((x, i) => (i === l.length - 1 ? { ...x, result } : x)));
    } catch (err) {
      const text = err instanceof ApiError && err.code === "cross_check_unavailable"
        ? "No answer is shown because the two models could not be cross-checked. Try again shortly."
        : err instanceof Error ? err.message : "Something went wrong";
      setLocal((l) => l.map((x, i) => (i === l.length - 1 ? { ...x, error: text } : x)));
    } finally { setBusy(false); }
  }

  const past: Message[] = history.data ?? [];
  return (
    <div className="stack">
      {threadInfo.data && (
        <div className="nav-back-bar">
          <Link href={`/tasks/${threadInfo.data.task_id}`} className="nav-back-link">
            ← Back to Task
          </Link>
          <Link href={`/projects/${threadInfo.data.project_id}`} className="nav-back-link">
            📂 Project Overview
          </Link>
          <Link href={`/projects/${threadInfo.data.project_id}/signals`} className="nav-back-link">
            📡 Signal Board
          </Link>
          <Link href={`/projects/${threadInfo.data.project_id}/concepts`} className="nav-back-link">
            💡 Concepts
          </Link>
          <Link href={`/projects/${threadInfo.data.project_id}/pipeline`} className="nav-back-link">
            📋 Pipeline (Kanban)
          </Link>
        </div>
      )}
      <div className="card">
        <h1>Research session</h1>
        <p className="muted">Answers come only from the approved sources. Every finding shows its source quote and page, and anything that cannot be verified is removed.</p>
        {history.error && <div className="notice error" role="alert">{history.error}</div>}
      </div>

      <ExportPanel threadId={id} disabled={past.length === 0 && local.length === 0} />

      <div className="chat" aria-live="polite">
        {past.map((m) => m.role === "user"
          ? <div className="q" key={m.id}>{m.content}</div>
          : m.final ? <AnswerView key={m.id} result={m.final} />
          : <div className="answer" key={m.id}>{m.content}</div>)}
        {local.map((x, i) => (
          <div className="chat" key={i}>
            <div className="q">{x.q}</div>
            {x.result && <AnswerView result={x.result} />}
            {x.error && <div className="notice error" role="alert">{x.error}</div>}
            {!x.result && !x.error && <div className="answer muted" role="status">Both models are answering and their findings are being verified against the sources…</div>}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form className="card stack" onSubmit={ask}>
        <label htmlFor="q" className="sr-only">Your question</label>
        <textarea id="q" value={question} placeholder="Ask a question about the approved sources" onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit(); }} />
        <div className="row between"><span className="muted">Ctrl/⌘ + Enter to send</span>
          <button type="submit" disabled={busy || question.trim().length < 3}>{busy ? "Working…" : "Ask"}</button></div>
      </form>
    </div>
  );
}

export default function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Shell><Body id={id} /></Shell>;
}
