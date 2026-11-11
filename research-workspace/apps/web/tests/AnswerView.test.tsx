import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AnswerView from "@/components/AnswerView";
import type { AskResult } from "@/lib/types";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const chunks = {
  [C1]: { label: "Smith 2024", source_id: "s1", filename: "smith.pdf", doi: null, page_start: 3, page_end: 3, sha256: "a".repeat(64), text: "Samples were stable at 4 C for twelve weeks." },
  [C2]: { label: "Lee 2023", source_id: "s2", filename: "lee.pdf", doi: null, page_start: 5, page_end: 6, sha256: "b".repeat(64), text: "With a citrate stabilizer the injection tolerated 25 C." },
};
const base: AskResult = {
  message_id: "m", kind: "consensus", reason: "models_agree", content: "", claims: [], disagreement: null,
  top_similarity: 0.83, verification: { status: "complete", verified: 2, purged: 1 },
  gate: { threshold: 0.76, top_similarity: 0.83, passed: true, corrupt_chunks_dropped: 0 }, chunks,
};

describe("AnswerView", () => {
  it("shows verified claims with source, page, quote highlight and the removed count", () => {
    render(<AnswerView result={{ ...base, claims: [
      { text: "Stable for 12 weeks at 4 C", chunk_ids: [C1], quote: "stable at 4 C for twelve weeks", conditions: "refrigerated", confirmed: true, match_kind: "exact", match_score: 1, seals: { [C1]: "a".repeat(64) } },
      { text: "Single model finding", chunk_ids: [C2], quote: "tolerated 25 C", conditions: null, confirmed: false, match_kind: "exact", match_score: 1, seals: {} },
    ] }} />);
    expect(screen.getByText("Verified answer")).toBeInTheDocument();
    expect(screen.getByText("2 model claims verified")).toBeInTheDocument();
    expect(screen.getByText("1 model claim removed (failed verification)")).toBeInTheDocument();
    expect(screen.getByText(/Best source match 0\.83 \(minimum 0\.76\)/)).toBeInTheDocument();
    expect(screen.getByText("Conditions: refrigerated")).toBeInTheDocument();
    expect(screen.getByText("Confirmed by both")).toBeInTheDocument();
    expect(screen.getByText("Single model")).toBeInTheDocument();
    expect(screen.getByText(/produced by only one model/)).toBeInTheDocument();
    expect(screen.getByText("Smith 2024")).toBeInTheDocument();
    expect(screen.getByText("p. 3")).toBeInTheDocument();
    expect(screen.getByText("pp. 5–6")).toBeInTheDocument();
    const marks = document.querySelectorAll("mark");
    expect(Array.from(marks).map((m) => m.textContent)).toContain("tolerated 25 C");
  });

  it("shows both positions side by side with their conditions on a disagreement", () => {
    const pos = (text: string, cond: string, id: string, quote: string) => ({ text, conditions: cond, chunk_ids: [id], quote, verified: true, match_kind: "exact", seals: {} });
    render(<AnswerView result={{ ...base, kind: "disagreement", reason: "conflicting_claims", disagreement: {
      reason: "conflicting_claims", model_a_claims: [], model_b_claims: [],
      conflicts: [{ topic: "Storage temperature limit", explanation: "4 C versus 25 C", detected_by: "numeric",
        position_a: pos("Stable at 4 C", "no stabilizer", C1, "stable at 4 C"), position_b: pos("Tolerated 25 C", "citrate stabilizer", C2, "tolerated 25 C") }],
    } }} />);
    expect(screen.getByText("Models disagree")).toBeInTheDocument();
    expect(screen.getByText("Storage temperature limit")).toBeInTheDocument();
    const a = screen.getByText("Model A (lead scientist)").closest(".pos") as HTMLElement;
    const b = screen.getByText("Model B (speed auditor)").closest(".pos") as HTMLElement;
    expect(within(a).getByText("Stable at 4 C")).toBeInTheDocument();
    expect(within(a).getByText("Conditions: no stabilizer")).toBeInTheDocument();
    expect(within(b).getByText("Conditions: citrate stabilizer")).toBeInTheDocument();
    expect(screen.getByText(/found by numeric check/)).toBeInTheDocument();
  });

  it("explains the similarity gate refusal and shows no claims", () => {
    render(<AnswerView result={{ ...base, kind: "insufficient_evidence", reason: "below_similarity_threshold",
      verification: { status: "complete", verified: 0, purged: 0 },
      gate: { threshold: 0.76, top_similarity: 0.41, passed: false, corrupt_chunks_dropped: 0 } }} />);
    expect(screen.getByText("Insufficient source evidence")).toBeInTheDocument();
    expect(screen.getByText(/best match 0\.41, required 0\.76\)\. The models were not asked/)).toBeInTheDocument();
    expect(document.querySelector(".claim")).toBeNull();
  });

  it("warns about corrupted passages", () => {
    render(<AnswerView result={{ ...base, kind: "insufficient_evidence", reason: "integrity_failure",
      gate: { threshold: 0.76, top_similarity: null, passed: false, corrupt_chunks_dropped: 2 } }} />);
    expect(screen.getByText("2 corrupted passages excluded")).toBeInTheDocument();
  });
});
