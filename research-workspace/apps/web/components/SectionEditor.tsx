"use client";
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";

export const SECTION_LABEL: Record<string, string> = {
  problem: "Problem", hypothesis: "Hypothesis", approach: "Approach", risks: "Risks", next_steps: "Next steps",
};

/** Edits one brief section. Remote updates never overwrite what you are typing: they appear as a notice instead. */
export default function SectionEditor({ conceptId, k, initial, version, onSaved, lockedBy, onFocusSection, live }: {
  conceptId: string; k: string; initial: string; version: number; onSaved: () => void;
  lockedBy?: string | null; onFocusSection?: (k: string | null) => void; live?: boolean;
}) {
  const [text, setText] = useState(initial);
  const [base, setBase] = useState(version);
  const loaded = useRef(initial);
  const [incoming, setIncoming] = useState<{ body: string; version: number } | null>(null);
  const [conflict, setConflict] = useState<{ body: string; version: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [lockMsg, setLockMsg] = useState<string | null>(null);
  const dirty = text !== loaded.current;

  // a newer version arrived from elsewhere
  useEffect(() => {
    if (version <= base && initial === loaded.current) return;
    if (!dirty) { setText(initial); setBase(version); loaded.current = initial; setIncoming(null); }
    else if (version > base) setIncoming({ body: initial, version });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, version]);

  async function save(overrideBase?: number) {
    setMsg(null);
    try {
      const r = await api.saveSection(conceptId, k, text, overrideBase ?? base);
      setBase(r.version); loaded.current = text; setConflict(null); setIncoming(null); setMsg("Saved."); onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === "version_conflict") {
        setConflict((e.detail as { current: { body: string; version: number } }).current);
      } else setMsg(e instanceof Error ? e.message : "Save failed");
    }
  }
  async function onFocus() {
    onFocusSection?.(k);
    if (!live) return;
    try { await api.lock(conceptId, k); setLockMsg(null); }
    catch (e) { if (e instanceof ApiError && e.status === 409) setLockMsg("Someone else is editing this section right now."); }
  }
  async function onBlur() {
    onFocusSection?.(null);
    if (live) { try { await api.unlock(conceptId, k); } catch { /* lock expires on its own */ } }
  }
  const adopt = (v: { body: string; version: number }) => { setText(v.body); loaded.current = v.body; setBase(v.version); setConflict(null); setIncoming(null); };

  return (
    <div className="stack">
      <label className="stack"><strong>{SECTION_LABEL[k]}</strong>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} onFocus={() => void onFocus()} onBlur={() => void onBlur()} /></label>
      {(lockedBy || lockMsg) && <div className="notice" role="status">{lockMsg ?? `Being edited by ${lockedBy}.`} You can still save; a stale save is stopped and shown their text.</div>}
      {incoming && !conflict && (
        <div className="notice" role="status">
          Someone saved a newer version while you were typing.{" "}
          <button type="button" className="secondary" onClick={() => adopt(incoming)}>Use their version</button>
        </div>
      )}
      {conflict && (
        <div className="notice error" role="alert">
          Someone else saved a newer version of this section. Their text:
          <blockquote>{conflict.body || "(empty)"}</blockquote>
          <button type="button" className="secondary" onClick={() => adopt(conflict)}>Use their version</button>{" "}
          <button type="button" onClick={() => { setBase(conflict.version); void save(conflict.version); }}>Overwrite with mine</button>
        </div>
      )}
      <div className="row"><button type="button" onClick={() => void save()} disabled={!dirty}>Save {SECTION_LABEL[k]}</button>
        {msg && <span className="muted" role="status">{msg}</span>}</div>
    </div>
  );
}
