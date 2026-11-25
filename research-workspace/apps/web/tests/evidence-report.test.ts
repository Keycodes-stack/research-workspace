import { describe, expect, it } from "vitest";
import { reportToMarkdown } from "@/lib/evidenceReport";
import type { GateReport } from "@/lib/types";

const report: GateReport = {
  generated_at: "2026-11-25T10:00:00Z",
  work_package: { code: "WP-1", title: "Storage", stage: "Discovery", due_date: null },
  research: { status: "complete", statement: "Stable to 480 °C.", papers_read: 10, error: null,
              started_at: null, finished_at: null },
  approval: { status: "not_recorded", note: "No approval has been recorded for this work package." },
  evidence: { total: 1, verified: 1, pending: 0, items: [{
    id: "1", evidence_id: "Evidence 001", task_id: "t", work_package_code: "WP-1", work_package_title: "Storage",
    claim_text: "Stable to 480 °C", quote: "stable up to 480 °C", status: "verified", found_by: ["model_a"],
    confirmed: true, chunk_ids: [], source_id: null, source_title: "Salt study", doi: null, source_url: null,
    origin: "openalex", pub_year: 2024, created_at: null }] },
  measurements: [{ text: "480 °C", value: 480, unit: "°C", evidence_id: "Evidence 001", work_package_code: "WP-1",
                   source_title: "Salt study" }],
  sources: [{ title: "Salt study", doi: "10.1/x", origin: "openalex", year: 2024, url: null }],
  audit: [{ at: "2026-11-25T09:00:00Z", action: "evidence.run" }],
};

describe("reportToMarkdown", () => {
  it("states that approval is not recorded, never that it was given", () => {
    const md = reportToMarkdown(report);
    expect(md).toContain("No approval has been recorded");
    expect(md).not.toMatch(/approved by/i);
  });

  it("lists evidence, measurements, sources and the audit trail", () => {
    const md = reportToMarkdown(report);
    expect(md).toContain("# Gate report: WP-1 · Storage");
    expect(md).toContain("**Evidence 001** [verified] Stable to 480 °C (Salt study, 2024)");
    expect(md).toContain("- 480 °C (Evidence 001, Salt study)");
    expect(md).toContain("Salt study (2024). doi:10.1/x openalex");
    expect(md).toContain("evidence.run");
  });

  it("says plainly when there is nothing in a section", () => {
    const empty = { ...report, measurements: [], sources: [], audit: [],
                    evidence: { total: 0, verified: 0, pending: 0, items: [] } };
    const md = reportToMarkdown(empty);
    expect(md).toContain("No measurements with units found");
    expect(md).toContain("No sources selected");
    expect(md).toContain("No evidence items.");
  });
});
