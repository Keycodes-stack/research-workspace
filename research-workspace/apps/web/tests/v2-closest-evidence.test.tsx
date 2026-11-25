import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AnswerCard from "@/components/v2/ask/AnswerCard";
import type { AskResult } from "@/lib/types";

const chunk = (label: string, text: string) => ({
  label, source_id: label, filename: null, doi: null, page_start: 3, page_end: 3, sha256: "x", text,
  origin: "user_upload", url: null,
});

/* An answer where nothing could be verified, but the sources were searched: the closest passages still show. */
const noAnswer: AskResult = {
  message_id: "m2", kind: "insufficient_evidence", reason: "both_models_insufficient", content: "",
  claims: [], disagreement: null, top_similarity: 0.4,
  verification: { status: "complete", verified: 0, purged: 0 },
  gate: { threshold: 0.65, top_similarity: 0.4, passed: true, corrupt_chunks_dropped: 0 },
  chunks: {
    c1: chunk("Smith 2024", "Storage temperature was not studied in this paper."),
    c2: chunk("Lee 2023", "Heat recovery depends on pressure drop across the pilot."),
  },
  related: ["c1", "c2"],
};

describe("closest evidence", () => {
  it("shows the closest passages in their own labelled section, not as an answer", () => {
    render(<AnswerCard result={noAnswer} />);
    const section = screen.getByRole("region", { name: "Closest evidence found" });
    expect(within(section).getByText(/Not a verified answer/)).toBeTruthy();
    expect(within(section).getByText("Smith 2024")).toBeTruthy();
    // the passage text shows in the summary and again in the expanded body
    expect(within(section).getAllByText(/Storage temperature was not studied/).length).toBeGreaterThan(0);
    expect(within(section).getByText("Lee 2023")).toBeTruthy();
  });

  it("shows no section when nothing was related", () => {
    render(<AnswerCard result={{ ...noAnswer, related: [] }} />);
    expect(screen.queryByRole("region", { name: "Closest evidence found" })).toBeNull();
  });
});
