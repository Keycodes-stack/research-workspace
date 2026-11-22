"use client";

import { useState } from "react";
import {
  ArrowUpRight01Icon,
  SearchList01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import Icon, { huge } from "@/components/v2/dashboard/Icon";

/**
 * Figma frame "Integrated Plan & Timeline" (1440 x 1080).
 * Card "Rectangle 2156": 885 wide at (515, 160), #FAFAFA, radius 20, border #EDEDF0, padding 20.
 * Tabs Inter 14/120: active 600 #285CE0 with 1px underline, others 400 #101D37.
 * Gantt box: 845 wide, white, radius 16, border; rows 805 x 43, radius 12, padding 10/16, gap 10.
 * Row label Inter 600 14 #242C2C; bars 20 high, radius 6 (#285CE0, critical #FF6720);
 * tick marks 8 x 18 #F2F1F1.
 */

type Row = {
  label: string;
  start: number; // % of track
  width: number; // % of track
  critical?: boolean;
  baseline: { start: number; width: number };
  alt: { start: number; width: number };
};

/* bar positions measured from the Figma frame, as % of the bar track */
const ROWS: Row[] = [
  { label: "Workstreams As Swimlanes", start: 2, width: 16, baseline: { start: 2, width: 16 }, alt: { start: 2, width: 16 } },
  { label: "Milestones And Deliverables With Dependencies", start: 10.5, width: 31, baseline: { start: 8, width: 28 }, alt: { start: 10.5, width: 26 } },
  { label: "Research Studies Run Concurrently When Independent", start: 24, width: 42, baseline: { start: 20, width: 38 }, alt: { start: 18, width: 40 } },
  { label: "Critical Path / Overlap / Resource Conflict", start: 36.4, width: 47, critical: true, baseline: { start: 32, width: 40 }, alt: { start: 30, width: 38 } },
  { label: "Forecast Completion Vs Approved Baseline", start: 42, width: 33.6, critical: true, baseline: { start: 38, width: 30 }, alt: { start: 40, width: 28 } },
  { label: "Alternative Sequence Simulation", start: 60, width: 39, baseline: { start: 55, width: 35 }, alt: { start: 52, width: 34 } },
];

const TICKS = [21, 52, 82];

const TABS = ["Timeline", "Critical Path", "Scenario Comparison"] as const;
type Tab = (typeof TABS)[number];

const INTEL = [
  "Critical path / overlap / resource conflict",
  "Forecast completion vs approved baseline",
  "Alternative sequence simulation",
];

const CONTROLS = ["Baseline overlay", "Change request links", "Calendar integration"] as const;
type Control = (typeof CONTROLS)[number];

function Bar({
  start,
  width,
  color,
  className = "",
  label,
}: {
  start: number;
  width: number;
  color: string;
  className?: string;
  label?: string;
}) {
  return (
    <span
      title={label}
      className={`absolute top-1/2 h-5 -translate-y-1/2 rounded-md transition-all duration-300 ${className}`}
      style={{ left: `${start}%`, width: `${width}%`, background: color }}
    />
  );
}

export default function PlanTimeline() {
  const [tab, setTab] = useState<Tab>("Timeline");
  const [on, setOn] = useState<Record<Control, boolean>>({
    "Baseline overlay": false,
    "Change request links": false,
    "Calendar integration": false,
  });
  const [focus, setFocus] = useState<number | null>(null);

  const showBaseline = on["Baseline overlay"] || tab === "Scenario Comparison";

  const pickIntel = (i: number) => {
    if (i === 0) setTab("Critical Path");
    if (i === 1) setOn((o) => ({ ...o, "Baseline overlay": true }));
    if (i === 2) setTab("Scenario Comparison");
  };

  return (
    <section className="flex w-full flex-col gap-5 rounded-[20px] border border-[#EDEDF0] bg-[#FAFAFA] p-5">
      {/* Tabs */}
      <div className="flex gap-6 border-b border-[#EDEDF0]" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b pb-2.5 text-sm leading-[1.2] tracking-[-0.02em] transition-colors ${
              tab === t
                ? "border-blue font-semibold text-blue"
                : "border-transparent text-[#101D37] hover:text-blue"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Gantt */}
      <div className="-mx-5 overflow-x-auto px-5">
        <div className="flex min-w-[600px] flex-col gap-2.5 rounded-2xl border border-[#EDEDF0] bg-white p-5">
          {ROWS.map((r, i) => {
            const dim =
              (tab === "Critical Path" && !r.critical) || (focus !== null && focus !== i);
            const color = r.critical && tab !== "Scenario Comparison" ? "#FF6720" : "#285CE0";
            const main =
              tab === "Scenario Comparison" ? r.alt : { start: r.start, width: r.width };
            /* Figma Timeline tab shows only the conflict row in orange */
            const timelineColor = i === 3 ? "#FF6720" : "#285CE0";
            return (
              <div
                key={r.label}
                onMouseEnter={() => setFocus(i)}
                onMouseLeave={() => setFocus(null)}
                className={`grid h-[43px] grid-cols-[minmax(0,252px)_minmax(0,1fr)] items-center gap-1.5 rounded-xl border border-[#EDEDF0] bg-white px-4 py-2.5 transition-opacity ${
                  dim ? "opacity-40" : "opacity-100"
                }`}
              >
                <span className="truncate text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[#242C2C]">
                  {r.label}
                </span>
                <div className="relative h-full">
                  {TICKS.map((t) => (
                    <span
                      key={t}
                      className="absolute top-1/2 h-[18px] w-2 -translate-y-1/2 bg-[#F2F1F1]"
                      style={{ left: `${t}%` }}
                    />
                  ))}
                  {showBaseline && (
                    <Bar
                      start={r.baseline.start}
                      width={r.baseline.width}
                      color="transparent"
                      className="z-10 border-[1.5px] border-dashed border-[#101D37]/50"
                      label="Approved baseline"
                    />
                  )}
                  <Bar
                    start={main.start}
                    width={main.width}
                    color={tab === "Timeline" ? timelineColor : color}
                    label={r.label}
                  />
                  {on["Change request links"] && i < ROWS.length - 1 && (
                    <span
                      className="absolute top-full z-10 w-px bg-blue/40"
                      style={{ left: `${main.start + main.width}%`, height: 20 }}
                    />
                  )}
                </div>
              </div>
            );
          })}
          {showBaseline && (
            <p className="flex items-center gap-2 pt-1 text-xs text-body">
              <span className="inline-block h-3 w-6 rounded border border-dashed border-[#98A2B3]" />
              Approved baseline
              {tab === "Scenario Comparison" && " · bars show the alternative sequence"}
            </p>
          )}
        </div>
      </div>

      {/* Schedule Intelligence + Controls – two columns, 413 wide, gap 10 */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-2.5">
          <h2 className="text-lg leading-[1.2] font-semibold tracking-[-0.02em] text-[#101D37]">
            Schedule Intelligence
          </h2>
          {INTEL.map((t, i) => (
            <button
              key={t}
              type="button"
              onClick={() => pickIntel(i)}
              className="flex h-10 items-center gap-2 rounded-lg border border-[#EDEDF0] bg-white px-3 text-left text-sm leading-[1.5] tracking-[-0.02em] text-body transition-colors hover:border-blue/30 hover:text-[#101D37]"
            >
              <Icon icon={huge(SearchList01Icon)} size={16} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{t}</span>
              <Icon icon={huge(ArrowUpRight01Icon)} size={14} stroke={1.2} className="shrink-0 text-[#101D37]" />
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2.5">
          <h2 className="text-lg leading-[1.2] font-semibold tracking-[-0.02em] text-[#101D37]">
            Controls
          </h2>
          {CONTROLS.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={on[c]}
              onClick={() => setOn((o) => ({ ...o, [c]: !o[c] }))}
              className={`flex h-10 items-center gap-2 rounded-lg border bg-white px-3 text-left text-sm leading-[1.5] tracking-[-0.02em] transition-colors ${
                on[c] ? "border-blue/40 text-blue" : "border-[#EDEDF0] text-body hover:text-[#101D37]"
              }`}
            >
              <Icon icon={huge(Tick02Icon)} size={16} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{c}</span>
              <Icon icon={huge(ArrowUpRight01Icon)} size={14} stroke={1.2} className="shrink-0 text-[#101D37]" />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
