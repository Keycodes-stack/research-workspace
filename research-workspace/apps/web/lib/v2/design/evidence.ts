/* Sample content for the Figma frame "Projects - Workspace" → "Evidence Extraction Ledger". */

/** One evidence batch in the chart: extracted → cited → validated (each ≤ the one before). */
export type EvidenceBar = { label: string; phase: "Baseline" | "Comparison" | "Revision"; extracted: number; cited: number; validated: number };

export const EVIDENCE_BARS: EvidenceBar[] = [
  { label: "Heat-loss survey", phase: "Baseline", extracted: 18, cited: 11, validated: 2 },
  { label: "Plant energy logs", phase: "Baseline", extracted: 10, cited: 6, validated: 3 },
  { label: "Supplier datasheets", phase: "Baseline", extracted: 14, cited: 5, validated: 4 },
  { label: "Exchanger trials", phase: "Baseline", extracted: 13, cited: 7, validated: 3 },
  { label: "Maintenance records", phase: "Comparison", extracted: 12, cited: 4, validated: 1 },
  { label: "Peer plant study", phase: "Comparison", extracted: 15, cited: 7, validated: 3 },
  { label: "Cost benchmarks", phase: "Comparison", extracted: 16, cited: 2, validated: 1 },
  { label: "Regulatory filings", phase: "Comparison", extracted: 20, cited: 8, validated: 4 },
  { label: "Pilot telemetry", phase: "Revision", extracted: 6, cited: 2, validated: 1 },
  { label: "Vendor quotes", phase: "Revision", extracted: 13, cited: 5, validated: 1 },
  { label: "Safety review", phase: "Revision", extracted: 17, cited: 8, validated: 4 },
  { label: "Financial model", phase: "Revision", extracted: 19, cited: 9, validated: 4 },
];

export type LedgerItem = { title: string; detail: string };

export const EVIDENCE_TABLE: LedgerItem[] = [
  { title: "Claim/measurement and unit", detail: "Each extracted claim is stored with its measured value and SI unit, e.g. 42 kW recoverable heat at 180 °C." },
  { title: "Supporting source passages", detail: "The exact passages that support the claim, linked to page and paragraph in the source document." },
  { title: "Study and method association", detail: "Which study, test method and sample the measurement came from, so like-for-like comparisons are possible." },
];

export const EXTRACTION_DETAIL: LedgerItem[] = [
  { title: "Original value and quoted context", detail: "The value as written in the source, with the surrounding sentence quoted verbatim." },
  { title: "AI-extracted vs human-verified flag", detail: "Shows whether the entry came from automatic extraction or was confirmed by a reviewer." },
  { title: "Quality/limitations/conflicting evidence", detail: "Known limitations of the source and any other evidence that disagrees with it." },
];

export const LINEAGE: LedgerItem[] = [
  { title: "Source evidence", detail: "The original document, dataset or interview the entry traces back to." },
  { title: "Verifier and timestamp", detail: "Who verified the entry and when, kept for every change." },
  { title: "Audit/precision fields", detail: "Precision, confidence and audit fields required for regulated reporting." },
];
