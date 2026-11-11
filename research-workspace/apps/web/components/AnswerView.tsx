"use client";
import { explainReason } from "@/lib/explain";
import type { AskResult, ChunkMeta, ModelClaim, Position } from "@/lib/types";
import CitationCard from "./CitationCard";

const TITLES = {
  consensus: "Verified answer",
  disagreement: "Models disagree",
  insufficient_evidence: "Insufficient source evidence",
} as const;

function Citations({ ids, quote, chunks, matchKind, seals }: {
  ids: string[]; quote: string; chunks: Record<string, ChunkMeta>; matchKind?: string | null; seals?: Record<string, string>;
}) {
  return <>{ids.map((id) => <CitationCard key={id} chunk={chunks[id]} quote={quote} matchKind={matchKind} seal={seals?.[id]} />)}</>;
}

function PositionBox({ who, p, chunks }: { who: string; p: Position | ModelClaim | null; chunks: Record<string, ChunkMeta> }) {
  return (
    <div className="pos">
      <h3>{who}</h3>
      {p ? (
        <>
          <div>{p.text}</div>
          {p.conditions && <div className="cond">Conditions: {p.conditions}</div>}
          <Citations ids={p.chunk_ids} quote={p.quote} chunks={chunks}
            matchKind={"match_kind" in p ? p.match_kind : null} seals={"seals" in p ? p.seals : undefined} />
        </>
      ) : <div className="muted">No corresponding finding.</div>}
    </div>
  );
}

export default function AnswerView({ result }: { result: AskResult }) {
  const { kind, claims, disagreement, verification, gate, chunks } = result;
  const unconfirmed = claims.filter((c) => !c.confirmed).length;

  return (
    <section className={`answer ${kind}`} aria-label="Answer">
      <div className="row between">
        <h2 style={{ margin: 0 }}>{TITLES[kind]}</h2>
        <span className={`badge ${kind === "consensus" ? "ok" : kind === "disagreement" ? "warn" : ""}`}>
          {kind === "consensus" ? "Both models agree" : kind === "disagreement" ? "No single answer" : "Not answered"}
        </span>
      </div>
      <p className="muted" style={{ margin: "6px 0 0" }}>{explainReason(result)}</p>

      <div className="vbar" aria-label="Verification summary">
        <span className="badge ok">{verification.verified} model claim{verification.verified === 1 ? "" : "s"} verified</span>
        <span className={`badge ${verification.purged ? "bad" : ""}`}>
          {verification.purged} model claim{verification.purged === 1 ? "" : "s"} removed (failed verification)
        </span>
        {gate.top_similarity != null && (
          <span className="badge">Best source match {gate.top_similarity.toFixed(2)} (minimum {gate.threshold.toFixed(2)})</span>
        )}
        {gate.corrupt_chunks_dropped > 0 && (
          <span className="badge bad">{gate.corrupt_chunks_dropped} corrupted passage{gate.corrupt_chunks_dropped === 1 ? "" : "s"} excluded</span>
        )}
      </div>

      {kind === "consensus" && (
        <>
          {unconfirmed > 0 && (
            <div className="notice" style={{ marginBottom: 8 }}>
              {unconfirmed} finding{unconfirmed === 1 ? " was" : "s were"} produced by only one model and not independently confirmed by the other.
            </div>
          )}
          {claims.map((c, i) => (
            <div className="claim" key={i}>
              <div className="row between" style={{ alignItems: "flex-start" }}>
                <div>{c.text}</div>
                <span className={`badge ${c.confirmed ? "ok" : "warn"}`}>{c.confirmed ? "Confirmed by both" : "Single model"}</span>
              </div>
              {c.conditions && <div className="cond">Conditions: {c.conditions}</div>}
              <Citations ids={c.chunk_ids} quote={c.quote} chunks={chunks} matchKind={c.match_kind} seals={c.seals} />
            </div>
          ))}
        </>
      )}

      {kind === "disagreement" && disagreement && (
        <>
          {disagreement.conflicts.map((c, i) => (
            <div className="conflict" key={i}>
              <h3>{c.topic}</h3>
              <div className="cols">
                <PositionBox who="Model A (lead scientist)" p={c.position_a} chunks={chunks} />
                <PositionBox who="Model B (speed auditor)" p={c.position_b} chunks={chunks} />
              </div>
              {c.explanation && <p className="muted">{c.explanation} <em>(found by {c.detected_by === "numeric" ? "numeric check" : c.detected_by === "judge" ? "cross-check" : "status comparison"})</em></p>}
            </div>
          ))}
          {disagreement.conflicts.length === 0 && (
            <div className="cols conflict">
              <ClaimList who="Model A" claims={disagreement.model_a_claims} chunks={chunks} />
              <ClaimList who="Model B" claims={disagreement.model_b_claims} chunks={chunks} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ClaimList({ who, claims, chunks }: { who: string; claims: ModelClaim[]; chunks: Record<string, ChunkMeta> }) {
  return (
    <div className="pos">
      <h3>{who}</h3>
      {claims.length === 0 && <div className="muted">No verified findings.</div>}
      {claims.map((c, i) => (
        <div className="claim" key={i}>
          <div>{c.text}</div>
          {c.conditions && <div className="cond">Conditions: {c.conditions}</div>}
          <Citations ids={c.chunk_ids} quote={c.quote} chunks={chunks} />
        </div>
      ))}
    </div>
  );
}
