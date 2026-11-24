import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AnswerCard from "@/components/v2/ask/AnswerCard";
import JudgeStatement, { statusChip } from "@/components/v2/ask/JudgeStatement";
import type { AskResult } from "@/lib/types";

const chunk = (label: string, text: string) => ({
  label, source_id: label, filename: null, doi: null, page_start: 3, page_end: 3, sha256: "x", text,
  origin: "user_upload", url: null,
});

const base: AskResult = {
  message_id: "m1", kind: "consensus", reason: "no_overlap", content: "",
  claims: [
    { text: "Stable at 4 C", chunk_ids: ["c1"], quote: "stable at 4 C", conditions: null, confirmed: false,
      match_kind: "exact", match_score: 1, seals: {} },
    { text: "Tolerates 25 C", chunk_ids: ["c2"], quote: "tolerated 25 C", conditions: null, confirmed: false,
      match_kind: "exact", match_score: 1, seals: {} },
  ],
  disagreement: null, top_similarity: 0.8,
  verification: { status: "complete", verified: 2, purged: 1 },
  gate: { threshold: 0.65, top_similarity: 0.8, passed: true, corrupt_chunks_dropped: 0 },
  chunks: {
    c1: chunk("Smith 2024", "The sample was stable at 4 C in buffer."),
    c2: chunk("Lee 2023", "It tolerated 25 C with citrate."),
  },
};

const position = (text: string, chunkId: string, quote: string) => ({
  text, conditions: null, chunk_ids: [chunkId], quote, verified: true, match_kind: "exact", seals: {},
});

const withModels: AskResult = {
  ...base,
  models: {
    model_a: {
      verified: 1, purged: 0, status: "answered", notes: null,
      claims: [{ text: "Stable at 4 C", quote: "stable at 4 C", verified: true, reason: "ok", match_kind: "exact", chunk_ids: ["c1"] }],
    },
    model_b: {
      verified: 0, purged: 1, status: "answered", notes: null,
      claims: [{ text: "Tolerates 25 C", quote: "tolerated 25 C", verified: false, reason: "quote_not_found", match_kind: null, chunk_ids: ["c2"] }],
    },
  },
  statement: "Both models found stability at 4 C; the second paper reports tolerance at 25 C with citrate.",
  differences: [{
    topic: "Stability temperature", detected_by: "judge", explanation: "The papers report different temperatures.",
    position_a: position("Stable at 4 C", "c1", "stable at 4 C"),
    position_b: position("Tolerates 25 C", "c2", "tolerated 25 C"),
  }],
};

describe("models side by side", () => {
  it("shows what each model found, with how many claims passed the quote check", () => {
    render(<AnswerCard result={withModels} />);
    const panel = screen.getByRole("region", { name: "Model A and Model B" });
    const a = within(panel).getByRole("article", { name: "Model A: Lead research scientist" });
    const b = within(panel).getByRole("article", { name: "Model B: Speed auditor" });
    expect(within(a).getByText(/1 of 1 claim verified/)).toBeInTheDocument();
    expect(within(b).getByText(/0 of 1 claim verified/)).toBeInTheDocument();
    expect(within(b).getByText("Removed: did not pass the quote check")).toBeInTheDocument();
    expect(within(a).getByText("Verified against the source")).toBeInTheDocument();
  });

  it("shows a model's insufficient verdict and its reason in its own column", () => {
    const r: AskResult = {
      ...withModels,
      models: { ...withModels.models!, model_b: { verified: 0, purged: 0, status: "insufficient_source_evidence",
        notes: "Only the abstract is available.", claims: [] } },
    };
    render(<AnswerCard result={r} />);
    expect(screen.getByText(/Found insufficient evidence in the sources: Only the abstract is available/)).toBeInTheDocument();
  });

  it("gives the same citation number to a paper everywhere it appears", () => {
    render(<AnswerCard result={withModels} />);
    const panel = screen.getByRole("region", { name: "Model A and Model B" });
    const a = within(panel).getByRole("article", { name: "Model A: Lead research scientist" });
    // Smith 2024 is cited first by the first finding, so it is [1] in the model column too
    expect(within(a).getByText("[1]")).toBeInTheDocument();
  });
});

describe("judge statement and differences", () => {
  it("shows the statement with a status chip and lists where the sources differ", () => {
    render(<AnswerCard result={withModels} />);
    const statement = screen.getByRole("region", { name: "Judge's statement" });
    expect(within(statement).getByText("Agree, with differences")).toBeInTheDocument();
    expect(within(statement).getByText(/Both models found stability/)).toBeInTheDocument();
    const diffs = screen.getByRole("region", { name: "Differences" });
    expect(within(diffs).getByText("Stability temperature")).toBeInTheDocument();
    expect(within(diffs).getByText("The papers report different temperatures.")).toBeInTheDocument();
  });

  it("an answer saved before this change renders as before: no panel, no statement", () => {
    render(<AnswerCard result={base} />);
    expect(screen.queryByRole("region", { name: "Model A and Model B" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Judge's statement" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Differences" })).toBeNull();
    expect(screen.getByText("Stable at 4 C")).toBeInTheDocument();
  });

  it("maps the answer to the right status chip", () => {
    expect(statusChip("consensus", false, false)).toBe("agree");
    expect(statusChip("consensus", true, false)).toBe("differences");
    expect(statusChip("consensus", false, true)).toBe("differences");
    expect(statusChip("disagreement", false, false)).toBe("disagree");
    expect(statusChip("insufficient_evidence", false, false)).toBe("none");
  });

  it("renders the statement text itself", () => {
    render(<JudgeStatement text="Both agree." chip="agree" />);
    expect(screen.getByText("Both agree.")).toBeInTheDocument();
    expect(screen.getByText("Agree")).toBeInTheDocument();
  });
});
