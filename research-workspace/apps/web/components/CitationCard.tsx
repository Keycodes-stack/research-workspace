"use client";
import { highlight, pageLabel } from "@/lib/highlight";
import { MATCH_LABEL } from "@/lib/explain";
import type { ChunkMeta } from "@/lib/types";

interface Props {
  chunk: ChunkMeta | undefined;
  quote: string;
  matchKind?: string | null;
  seal?: string;
  verified?: boolean;
}

/** One citation: source, page, the verified quote, and the source passage with the quote marked. */
export default function CitationCard({ chunk, quote, matchKind, seal, verified = true }: Props) {
  if (!chunk) return <div className="cite"><div className="body muted">Source unavailable.</div></div>;
  const pages = pageLabel(chunk.page_start, chunk.page_end);
  const segs = highlight(chunk.text, quote);
  return (
    <details className="cite">
      <summary>
        <span className={`badge ${verified ? "ok" : "bad"}`}>{verified ? "Verified" : "Not verified"}</span>
        <strong>{chunk.label}</strong>
        {pages && <span className="muted">{pages}</span>}
      </summary>
      <div className="body stack">
        <blockquote style={{ margin: 0, paddingLeft: 10, borderLeft: "3px solid var(--line)" }}>“{quote}”</blockquote>
        <div className="muted">
          {matchKind ? MATCH_LABEL[matchKind] ?? matchKind : null}
          {seal && <> · SHA-256 <span className="hash" title={seal}>{seal.slice(0, 12)}…</span> matched</>}
        </div>
        <div>
          <div className="muted" style={{ marginBottom: 4 }}>Source passage{segs ? "" : " (quote matched approximately, so it is not highlighted)"}</div>
          <div className="passage">
            {segs ? segs.map((s, i) => (s.mark ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>)) : chunk.text}
          </div>
        </div>
      </div>
    </details>
  );
}
