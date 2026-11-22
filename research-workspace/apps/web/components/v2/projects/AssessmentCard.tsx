import type { ProjectInsights } from "@/lib/projectIntake";

const LEVEL: Record<string, string> = {
  High: "bg-[#FEF3F2] text-[#B42318]",
  Medium: "bg-[#FFFAEB] text-[#B54708]",
  Low: "bg-[#ECFDF3] text-[#067647]",
};

/** The AI assessment of a project. Its figures are suggestions to review, not findings. */
export default function AssessmentCard({ insights, title = "AI assessment" }: { insights: ProjectInsights; title?: string }) {
  return <section aria-label={title} className="flex flex-col gap-5 rounded-[20px] border border-[#EDEDF0] bg-white p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-[#101D37]">{title}</h2>
        <p className="mt-0.5 text-xs text-[#667085]">Suggested from the project details. Confirm before relying on it.</p>
      </div>
      <span className="rounded-full bg-blue/[0.08] px-3 py-1 text-sm font-semibold text-blue">Feasibility {insights.feasibility}%</span>
    </div>
    {insights.summary && <p className="text-sm leading-6 text-[#344054]">{insights.summary}</p>}
    {insights.recommendation && <p className="rounded-[12px] bg-[#F8FAFC] p-3 text-sm text-[#344054]"><span className="font-semibold text-[#101D37]">Recommendation: </span>{insights.recommendation}</p>}
    {insights.stats.length > 0 && <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {insights.stats.map((s) => <div key={s.label} className="rounded-[12px] border border-[#EDEDF0] p-3"><dt className="text-xs text-[#667085]">{s.label}</dt><dd className="mt-1 text-base font-semibold text-[#101D37]">{s.value}</dd></div>)}
    </dl>}
    {insights.risks.length > 0 && <div>
      <h3 className="mb-2 text-sm font-semibold text-[#101D37]">Risks</h3>
      <ul className="flex flex-col gap-2">
        {insights.risks.map((r, i) => <li key={i} className="rounded-[12px] border border-[#EDEDF0] p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-[#101D37]">{r.risk}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL[r.likelihood] ?? LEVEL.Medium}`}>Likelihood {r.likelihood}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL[r.impact] ?? LEVEL.Medium}`}>Impact {r.impact}</span></div>
          {r.mitigation && <p className="mt-1 text-[#667085]">Mitigation: {r.mitigation}</p>}
          {r.owner && <p className="text-xs text-[#667085]">Owner: {r.owner}</p>}
        </li>)}
      </ul>
    </div>}
    <div className="grid gap-5 md:grid-cols-2">
      {insights.questions.length > 0 && <div><h3 className="mb-2 text-sm font-semibold text-[#101D37]">Open questions</h3><ul className="list-inside list-disc text-sm text-[#344054]">{insights.questions.map((q) => <li key={q}>{q}</li>)}</ul></div>}
      {insights.nextSteps.length > 0 && <div><h3 className="mb-2 text-sm font-semibold text-[#101D37]">Next steps</h3><ol className="list-inside list-decimal text-sm text-[#344054]">{insights.nextSteps.map((s) => <li key={s}>{s}</li>)}</ol></div>}
    </div>
  </section>;
}
