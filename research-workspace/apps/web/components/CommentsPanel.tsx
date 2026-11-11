"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import type { CommentRow, CommentsResp } from "@/lib/types";

const STANCES = ["support", "challenge", "question", "note"] as const;
const SECTIONS = ["", "problem", "hypothesis", "approach", "risks", "next_steps", "evidence", "scoring"];
const short = (u: string) => u.slice(0, 8);

function Thread({ c, all, conceptId, onChange }: { c: CommentRow; all: CommentRow[]; conceptId: string; onChange: () => void }) {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [stance, setStance] = useState<string>("support");
  const kids = all.filter((x) => x.parent_id === c.id);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    await api.addComment(conceptId, text.trim(), stance, c.section, c.id); setText(""); setReplying(false); onChange();
  }
  return (
    <li className="stack" style={{ opacity: c.resolved ? 0.6 : 1 }}>
      <div><span className={`badge ${c.stance === "challenge" ? "warn" : c.stance === "support" ? "ok" : ""}`}>{c.stance}</span>{" "}
        {c.section && <span className="badge">{c.section.replace("_", " ")}</span>} <span className="muted">{short(c.author)}</span>
        {c.resolved && <span className="badge">resolved</span>}</div>
      <div>{c.body}</div>
      <div className="row">
        <button type="button" className="secondary" onClick={() => setReplying(!replying)}>Reply</button>
        {!c.parent_id && <button type="button" className="secondary" onClick={async () => { await api.resolveComment(c.id, !c.resolved); onChange(); }}>{c.resolved ? "Reopen" : "Resolve"}</button>}
      </div>
      {replying && (
        <form className="row" onSubmit={send}>
          <select aria-label="Reply stance" value={stance} onChange={(e) => setStance(e.target.value)}>{STANCES.map((s) => <option key={s}>{s}</option>)}</select>
          <input style={{ flex: 1 }} value={text} onChange={(e) => setText(e.target.value)} aria-label="Reply" required />
          <button type="submit" disabled={!text.trim()}>Send reply</button>
        </form>
      )}
      {kids.length > 0 && <ul className="list" style={{ marginLeft: 16 }}>{kids.map((k) => <Thread key={k.id} c={k} all={all} conceptId={conceptId} onChange={onChange} />)}</ul>}
    </li>
  );
}

export default function CommentsPanel({ conceptId, data, onChange }: { conceptId: string; data: CommentsResp | null; onChange: () => void }) {
  const [text, setText] = useState("");
  const [stance, setStance] = useState<string>("note");
  const [section, setSection] = useState("");
  const [err, setErr] = useState<string | null>(null);
  async function post(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try { await api.addComment(conceptId, text.trim(), stance, section || null); setText(""); onChange(); }
    catch (x) { setErr(x instanceof Error ? x.message : "Failed"); }
  }
  const roots = data?.comments.filter((c) => !c.parent_id) ?? [];
  return (
    <div className="card stack">
      <h2>Discussion</h2>
      <p className="muted">{data?.note ?? "Comments are written by people and are not source-verified."}</p>
      {data && Object.keys(data.summary).length > 0 && (
        <p>Open threads: {Object.entries(data.summary).map(([sec, s]) =>
          `${sec.replace("_", " ")} (${Object.entries(s).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(", ")})`).join(" · ")}</p>
      )}
      <ul className="list stack">{roots.map((c) => <Thread key={c.id} c={c} all={data!.comments} conceptId={conceptId} onChange={onChange} />)}</ul>
      {data && roots.length === 0 && <p className="muted">No comments yet.</p>}
      <form className="stack" onSubmit={post}>
        <div className="row">
          <select aria-label="Stance" value={stance} onChange={(e) => setStance(e.target.value)}>{STANCES.map((s) => <option key={s}>{s}</option>)}</select>
          <select aria-label="About" value={section} onChange={(e) => setSection(e.target.value)}>
            {SECTIONS.map((s) => <option key={s} value={s}>{s ? s.replace("_", " ") : "General"}</option>)}</select>
        </div>
        <textarea aria-label="Comment" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add to the discussion" maxLength={4000} />
        {err && <div className="notice error" role="alert">{err}</div>}
        <div><button type="submit" disabled={!text.trim()}>Post comment</button></div>
      </form>
    </div>
  );
}
