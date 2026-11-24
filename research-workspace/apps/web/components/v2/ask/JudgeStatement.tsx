"use client";

import type { AnswerKind } from "@/lib/types";

/*
 * The closing statement of the cross-check: what both models found and where they differ. It states what the citations
 * support; it never says which model is right.
 */
const CHIP: Record<string, { label: string; tone: string }> = {
  agree: { label: "Agree", tone: "bg-[#ECFDF3] text-[#067647]" },
  differences: { label: "Agree, with differences", tone: "bg-[#FFFAEB] text-[#B54708]" },
  disagree: { label: "Disagree", tone: "bg-[#FFFAEB] text-[#B54708]" },
  none: { label: "No answer", tone: "bg-[#F2F4F7] text-[#344054]" },
};

export function statusChip(kind: AnswerKind, hasDifferences: boolean, oneModelOnly: boolean): keyof typeof CHIP {
  if (kind === "disagreement") return "disagree";
  if (kind === "insufficient_evidence") return "none";
  if (hasDifferences) return "differences";
  return oneModelOnly ? "differences" : "agree";
}

export default function JudgeStatement({ text, chip }: { text: string; chip: keyof typeof CHIP }) {
  const c = CHIP[chip];
  return (
    <section aria-label="Judge's statement" className="flex flex-col gap-2 rounded-xl border border-[#EDEDF0] bg-[#FAFAFA] p-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[#101D37]">Judge&apos;s statement</h3>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${c.tone}`}>{c.label}</span>
      </header>
      <p className="text-sm leading-[1.5] text-[#101D37]">{text}</p>
    </section>
  );
}
