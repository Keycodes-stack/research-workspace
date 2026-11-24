"use client";

import { explainReason } from "@/lib/explain";
import type { AskResult, Position } from "@/lib/types";
import { answerFacts, citeSources, plainContent, type CitedSource } from "@/lib/v2/answer";
import JudgeStatement, { statusChip } from "./JudgeStatement";
import ModelsPanel from "./ModelsPanel";

/*
 * The design has no answer screen, so this card follows the design's chat style (white card, #EDEDF0 border, radius
 * 12–16, 12–14 px text). Every finding shows the numbers of the papers it quotes; the list below gives each paper,
 * a link to it, and the quoted passages.
 */
const KIND = {
  consensus: { title: "Answer", badge: "Both models checked", tone: "bg-[#ECFDF3] text-[#067647]" },
  disagreement: { title: "The models disagree", badge: "No single answer", tone: "bg-[#FFFAEB] text-[#B54708]" },
  insufficient_evidence: { title: "No answer in the sources", badge: "Not answered", tone: "bg-[#F2F4F7] text-[#344054]" },
} as const;

const Refs = ({ ns }: { ns: number[] }) =>
  ns.length ? <span className="ml-1 text-xs font-semibold text-blue">{ns.map((n) => `[${n}]`).join("")}</span> : null;

function Marked({ text, quote }: { text: string; quote: string }) {
  const i = quote ? text.indexOf(quote) : -1;
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark className="rounded bg-[#E8EEFC] px-0.5 text-[#101D37]">{quote}</mark>{text.slice(i + quote.length)}</>;
}

function SourceList({ sources }: { sources: CitedSource[] }) {
  if (!sources.length) return null;
  return (
    <section aria-label="Sources" className="flex flex-col gap-2 border-t border-[#EDEDF0] pt-3">
      <h3 className="text-sm font-semibold text-[#101D37]">Sources ({sources.length})</h3>
      <ol className="flex flex-col gap-2">
        {sources.map((s) => (
          <li key={s.n} className="rounded-xl border border-[#EDEDF0] bg-[#FAFAFA] p-2.5">
            <p className="text-xs leading-[1.5] text-[#101D37]">
              <span className="font-semibold text-blue">[{s.n}]</span>{" "}
              {s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="font-medium underline-offset-2 hover:underline">{s.title}</a>
                : <span className="font-medium">{s.title}</span>}
            </p>
            <p className="text-[11px] leading-[1.5] text-body">{s.origin}{s.doi ? ` · doi:${s.doi}` : ""}</p>
            {s.passages.map((p) => (
              <details key={`${p.chunkId}-${p.quote}`} className="mt-1.5">
                <summary className="cursor-pointer text-[11px] leading-[1.5] text-[#242C2C]">
                  {p.pages ? `${p.pages}: ` : ""}“{p.quote}”
                </summary>
                <p className="mt-1 rounded-lg border border-[#EDEDF0] bg-white p-2 text-[11px] leading-[1.6] whitespace-pre-wrap text-[#344054]">
                  <Marked text={p.text} quote={p.quote} />
                </p>
              </details>
            ))}
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function AnswerCard({ result }: { result: AskResult }) {
  const k = KIND[result.kind];
  const { refs, sources } = citeSources(result.chunks ?? {});

  // Numbers are given in reading order, so the findings are built before the source list.
  const claims = (result.claims ?? []).map((c) => ({ ...c, ns: refs(c.chunk_ids, c.quote) }));
  const conflicts = (result.disagreement?.conflicts ?? []).map((cf) => {
    const side = (p: Position | null) => (p ? { ...p, ns: refs(p.chunk_ids, p.quote) } : null);
    return { ...cf, a: side(cf.position_a), b: side(cf.position_b) };
  });
  const single = claims.filter((c) => !c.confirmed).length;
  // Differences (lenient cross-check) and each model's own claims: numbered here, before the source list is built.
  const diffs = (result.differences ?? []).map((cf) => {
    const side = (p: Position | null) => (p ? { ...p, ns: refs(p.chunk_ids, p.quote) } : null);
    return { ...cf, a: side(cf.position_a), b: side(cf.position_b) };
  });
  const models = result.models ?? null;
  const claimNs: Partial<Record<"model_a" | "model_b", number[][]>> = {};
  for (const key of ["model_a", "model_b"] as const) {
    const m = models?.[key];
    // A removed claim's quote never reached a source, so it gets no number.
    if (m) claimNs[key] = m.claims.map((c) => (c.verified ? refs(c.chunk_ids, c.quote) : []));
  }
  const chip = statusChip(result.kind, diffs.length > 0, single > 0);

  return (
    <article aria-label={k.title} className="flex w-full flex-col gap-3 rounded-2xl border border-[#EDEDF0] bg-white p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-[-0.02em] text-[#101D37]">{k.title}</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${k.tone}`}>{k.badge}</span>
      </header>
      <p className="text-xs leading-[1.5] text-body">{answerFacts(result).join(" · ")}</p>

      {result.kind === "consensus" && (
        <>
          {single > 0 && (
            <p className="text-xs leading-[1.5] text-[#B54708]">
              {single} finding{single === 1 ? " was" : "s were"} given by one model only: checked against the source
              text, but not confirmed by the other model.
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {claims.map((c, i) => (
              <li key={i} className="flex flex-col gap-1 rounded-xl border border-[#EDEDF0] bg-[#FAFAFA] p-2.5">
                <p className="text-sm leading-[1.5] text-[#101D37]">{c.text}<Refs ns={c.ns} /></p>
                {c.conditions && <p className="text-xs text-body">Conditions: {c.conditions}</p>}
                <span className={`w-fit rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  c.confirmed ? "bg-[#ECFDF3] text-[#067647]" : "bg-[#FFFAEB] text-[#B54708]"}`}>
                  {c.confirmed ? "Confirmed by both models" : "One model only"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {result.kind === "disagreement" && (
        <>
          <p className="text-sm leading-[1.5] text-[#101D37]">{explainReason(result)}</p>
          <ul className="flex flex-col gap-2">
            {conflicts.map((cf, i) => (
              <li key={i} className="flex flex-col gap-2 rounded-xl border border-[#EDEDF0] bg-[#FAFAFA] p-2.5">
                <p className="text-sm font-medium text-[#101D37]">{cf.topic}</p>
                {([["Model A", cf.a], ["Model B", cf.b]] as const).map(([who, p]) => (
                  <p key={who} className="text-sm leading-[1.5] text-[#101D37]">
                    <span className="font-semibold">{who}: </span>
                    {p ? <>{p.text}<Refs ns={p.ns} />{p.conditions && <span className="text-body"> ({p.conditions})</span>}</>
                      : <span className="text-body">no finding on this point</span>}
                  </p>
                ))}
                {cf.explanation && <p className="text-xs text-body">{cf.explanation}</p>}
              </li>
            ))}
          </ul>
        </>
      )}

      {result.kind === "insufficient_evidence" && (
        <p className="text-sm leading-[1.5] whitespace-pre-wrap text-[#101D37]">
          {plainContent(result.content) || explainReason(result)}
        </p>
      )}

      {diffs.length > 0 && (
        <section aria-label="Differences" className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-[#101D37]">Where the sources differ ({diffs.length})</h3>
          <ul className="flex flex-col gap-2">
            {diffs.map((cf, i) => (
              <li key={i} className="flex flex-col gap-2 rounded-xl border border-[#EDEDF0] bg-[#FAFAFA] p-2.5">
                <p className="text-sm font-medium text-[#101D37]">{cf.topic}</p>
                {([["Model A", cf.a], ["Model B", cf.b]] as const).map(([who, p]) => (
                  <p key={who} className="text-sm leading-[1.5] text-[#101D37]">
                    <span className="font-semibold">{who}: </span>
                    {p ? <>{p.text}<Refs ns={p.ns} />{p.conditions && <span className="text-body"> ({p.conditions})</span>}</>
                      : <span className="text-body">no finding on this point</span>}
                  </p>
                ))}
                {cf.explanation && <p className="text-xs text-body">{cf.explanation}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {models && <ModelsPanel models={models} claimNs={claimNs} />}

      {result.statement
        ? <JudgeStatement text={result.statement} chip={chip} />
        : result.kind === "consensus" && <p className="text-xs text-body">{explainReason(result)}</p>}
      <SourceList sources={sources()} />
    </article>
  );
}
