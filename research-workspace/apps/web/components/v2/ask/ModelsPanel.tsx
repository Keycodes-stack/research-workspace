"use client";

import type { AskResult, ModelBreakdown } from "@/lib/types";

/*
 * Model A and Model B side by side: what each one claimed, which claims survived the quote check, and the same [n]
 * numbers the findings use (one number per paper, shared across the whole answer).
 */
const ROLES: { key: "model_a" | "model_b"; title: string; role: string }[] = [
  { key: "model_a", title: "Model A", role: "Lead research scientist" },
  { key: "model_b", title: "Model B", role: "Speed auditor" },
];

const INSUFFICIENT = "insufficient_source_evidence";

/** `claimNs[key][i]` are the [n] numbers of that model's i-th claim, computed up front by the card so every number is
 * assigned before the source list is built. */
export default function ModelsPanel({
  models, claimNs,
}: {
  models: NonNullable<AskResult["models"]>;
  claimNs: Partial<Record<"model_a" | "model_b", number[][]>>;
}) {
  return (
    <section aria-label="Model A and Model B" className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-[#101D37]">What each model found</h3>
      <div className="grid gap-3 md:grid-cols-2">
        {ROLES.map(({ key, title, role }) => {
          const m = models[key];
          if (!m) return null;
          return <ModelColumn key={key} title={title} role={role} m={m} claimNs={claimNs[key] ?? []} />;
        })}
      </div>
    </section>
  );
}

function ModelColumn({
  title, role, m, claimNs,
}: { title: string; role: string; m: ModelBreakdown; claimNs: number[][] }) {
  const total = m.verified + m.purged;
  const insufficient = m.status === INSUFFICIENT;
  return (
    <article aria-label={`${title}: ${role}`} className="flex flex-col gap-2 rounded-xl border border-[#EDEDF0] bg-[#FAFAFA] p-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-[#101D37]">{title}</h4>
        <span className="text-xs text-body">{role}</span>
      </header>
      {insufficient ? (
        <p className="text-xs leading-[1.5] text-[#B54708]">
          Found insufficient evidence in the sources{m.notes ? `: ${m.notes}` : "."}
        </p>
      ) : (
        <p className="text-xs leading-[1.5] text-body">
          {m.verified} of {total} claim{total === 1 ? "" : "s"} verified against the source text
          {m.purged ? `, ${m.purged} removed` : ""}.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {m.claims.map((c, i) => {
          // A removed claim's quote never reached a source, so it gets no citation number (see the card).
          const nums = claimNs[i] ?? [];
          return (
            <li key={i} className="flex flex-col gap-1 rounded-lg border border-[#EDEDF0] bg-white p-2">
              <p className="text-sm leading-[1.5] text-[#101D37]">
                {c.text}
                {nums.length > 0 && <span className="ml-1 text-xs font-semibold text-blue">{nums.map((n) => `[${n}]`).join("")}</span>}
              </p>
              <span className={`w-fit rounded-full px-2 py-0.5 text-[11px] font-medium ${
                c.verified ? "bg-[#ECFDF3] text-[#067647]" : "bg-[#FEF3F2] text-[#B42318]"}`}>
                {c.verified ? "Verified against the source" : "Removed: did not pass the quote check"}
              </span>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
