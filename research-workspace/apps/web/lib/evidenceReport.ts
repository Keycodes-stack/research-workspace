import type { GateReport } from "@/lib/types";

/* The gate report as a Markdown document, for download. Pure: the page builds the file and saves it. */
const line = (label: string, value: string | number | null | undefined) =>
  `- **${label}:** ${value === null || value === undefined || value === "" ? "—" : value}`;

export function reportToMarkdown(r: GateReport): string {
  const wp = r.work_package;
  const out: string[] = [
    `# Gate report: ${[wp.code, wp.title].filter(Boolean).join(" · ") || "Work package"}`,
    "",
    `Generated ${r.generated_at}`,
    "",
    "## Work package",
    line("Stage", wp.stage),
    line("Due", wp.due_date),
    "",
    "## Research",
    line("Status", r.research.status),
    line("Papers read", r.research.papers_read),
    line("Started", r.research.started_at),
    line("Finished", r.research.finished_at),
    line("Error", r.research.error),
    "",
    r.research.statement ? r.research.statement : "No research statement yet.",
    "",
    "## Approval",
    `${r.approval.note}`,
    "",
    `## Evidence (${r.evidence.total}: ${r.evidence.verified} verified, ${r.evidence.pending} pending)`,
  ];
  if (r.evidence.items.length === 0) out.push("No evidence items.");
  for (const it of r.evidence.items) {
    const source = it.source_title ? ` (${it.source_title}${it.pub_year ? `, ${it.pub_year}` : ""})` : "";
    out.push(`- **${it.evidence_id}** [${it.status}] ${it.claim_text}${source}`);
    if (it.quote) out.push(`  > ${it.quote}`);
  }
  out.push("", "## Measurements");
  if (r.measurements.length === 0) out.push("No measurements with units found in the evidence.");
  for (const m of r.measurements) {
    out.push(`- ${m.text} (${m.evidence_id ?? "—"}${m.source_title ? `, ${m.source_title}` : ""})`);
  }
  out.push("", "## Sources");
  if (r.sources.length === 0) out.push("No sources selected for this work package.");
  for (const s of r.sources) {
    const doi = s.doi ? ` doi:${s.doi}` : "";
    out.push(`- ${s.title ?? "untitled"}${s.year ? ` (${s.year})` : ""}.${doi} ${s.origin ?? ""}`.trimEnd());
  }
  out.push("", "## Audit trail");
  if (r.audit.length === 0) out.push("No audit entries yet.");
  for (const a of r.audit) out.push(`- ${a.at ?? "—"}: ${a.action}`);
  return out.join("\n") + "\n";
}
