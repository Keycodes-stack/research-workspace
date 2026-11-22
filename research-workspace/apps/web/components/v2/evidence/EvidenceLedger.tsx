"use client";

import { useState } from "react";
import { Add01Icon, FilterHorizontalIcon, SearchList01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import Icon, { huge } from "@/components/v2/dashboard/Icon";
import DetailRows, { SectionTitle as H3 } from "@/components/v2/projects/DetailRows";
import { EVIDENCE_BARS, EVIDENCE_TABLE, EXTRACTION_DETAIL, LINEAGE } from "@/lib/v2/design/evidence";

/*
 * Figma "Evidence Extraction Ledger" (inside frame "Projects - Workspace"):
 *  card 885 wide, #FAFAFA, border #EDEDF0, radius 20, padding 20
 *  chart: white card radius 20, three-tone blue bars (#285CE0 / 30% / 15%), axis labels caps 12 #667085
 *  rows: white, border #EDEDF0, radius 10, ~40 high, gap 12, Inter 12 #667085, arrow-up-right at the end
 */

const MAX = Math.max(...EVIDENCE_BARS.map((b) => b.extracted));

function Chart() {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="relative rounded-[20px] bg-white px-5 pt-6 pb-4">
      <div className="relative h-[184px]">
        {/* faint dashed grid */}
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between py-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="border-t border-dashed border-[#EDEDF0]" />
          ))}
        </div>
        <div className="relative flex h-full items-end justify-between gap-1">
          {EVIDENCE_BARS.map((b, i) => (
            <button
              key={b.label}
              type="button"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${b.label}: ${b.extracted} extracted, ${b.cited} cited, ${b.validated} validated`}
              className="group relative flex h-full w-4 flex-col justify-end"
            >
              {/* one rounded pill, three stacked tones */}
              <span
                className="flex w-4 flex-col overflow-hidden rounded-full transition-opacity group-hover:opacity-90"
                style={{ height: `${(b.extracted / MAX) * 100}%` }}
              >
                <span className="flex-1 bg-blue/15" />
                <span className="bg-blue/30" style={{ height: `${((b.cited - b.validated) / b.extracted) * 100}%` }} />
                <span className="bg-blue" style={{ height: `${(b.validated / b.extracted) * 100}%`, minHeight: 10 }} />
              </span>
              {hover === i && (
                <span
                  role="tooltip"
                  className={`absolute bottom-full z-10 mb-2 w-max rounded-lg bg-[#101D37] px-2.5 py-1.5 text-left text-[11px] leading-[1.5] text-white shadow-lg ${
                    i > EVIDENCE_BARS.length - 4 ? "right-0" : "left-1/2 -translate-x-1/2"
                  }`}
                >
                  <span className="block font-semibold">{b.label}</span>
                  <span className="block text-white/80">
                    {b.extracted} extracted · {b.cited} cited · {b.validated} validated
                  </span>
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 flex justify-between text-xs leading-[1.5] tracking-[0.02em] text-body uppercase">
        <span>Baseline</span>
        <span>Comparison</span>
        <span>Revision</span>
      </div>
    </div>
  );
}

const TOTAL = EVIDENCE_BARS.reduce(
  (a, b) => ({ cited: a.cited + b.cited, awaiting: a.awaiting + (b.cited - b.validated) }),
  { cited: 0, awaiting: 0 },
);

function Status() {
  const [view, setView] = useState<"cited" | "awaiting">("awaiting");
  const items = [...EVIDENCE_BARS]
    .map((b) => ({ label: b.label, n: view === "cited" ? b.cited : b.cited - b.validated }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 3);
  return (
    <div className="flex min-h-[124px] flex-col gap-3 rounded-[10px] border border-[#EDEDF0] bg-white p-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={view === "cited"}
          onClick={() => setView("cited")}
          className={`flex h-7 items-center gap-1 rounded-lg border px-2.5 text-xs leading-[1.5] font-semibold tracking-[-0.02em] ${
            view === "cited" ? "border-blue bg-blue text-white" : "border-[#EDEDF0] bg-white text-[#242C2C]"
          }`}
        >
          <Icon icon={huge(FilterHorizontalIcon)} size={13} stroke={1.4} />
          Cited Imports · {TOTAL.cited}
        </button>
        <button
          type="button"
          aria-pressed={view === "awaiting"}
          onClick={() => setView("awaiting")}
          className={`flex h-7 items-center gap-1 rounded-lg border px-2.5 text-xs leading-[1.5] font-semibold tracking-[-0.02em] ${
            view === "awaiting" ? "border-blue bg-blue text-white" : "border-[#EDEDF0] bg-white text-[#242C2C]"
          }`}
        >
          <Icon icon={huge(Add01Icon)} size={13} stroke={1.4} />
          Awaiting Validation · {TOTAL.awaiting}
        </button>
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map((it) => (
          <li key={it.label} className="flex items-center justify-between text-xs leading-[1.5] text-body">
            <span>{it.label}</span>
            <span className="font-semibold text-[#101D37]">{it.n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function EvidenceLedger() {
  return (
    <section className="flex w-full flex-col gap-5 rounded-[20px] border border-[#EDEDF0] bg-[#FAFAFA] p-5">
      <div className="flex flex-col gap-2.5">
        <H3>Evidence Table</H3>
        <Chart />
      </div>

      <div className="grid gap-[19px] md:grid-cols-2">
        <DetailRows items={EVIDENCE_TABLE} icon={huge(SearchList01Icon)} />
        <div className="flex flex-col gap-2.5">
          <H3>Evidence Status</H3>
          <Status />
        </div>
      </div>

      <div className="h-px w-full bg-[#EDEDF0]" />

      <div className="grid gap-[19px] md:grid-cols-2">
        <div className="flex flex-col gap-2.5">
          <H3>Extraction Detail</H3>
          <DetailRows items={EXTRACTION_DETAIL} icon={huge(SearchList01Icon)} />
        </div>
        <div className="flex flex-col gap-2.5">
          <H3>Lineage</H3>
          <DetailRows items={LINEAGE} icon={huge(Tick02Icon)} />
        </div>
      </div>
    </section>
  );
}
