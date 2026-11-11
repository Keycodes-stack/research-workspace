import type { AskResult } from "./types";

/** Plain-language explanation of why the system answered the way it did. */
export function explainReason(r: Pick<AskResult, "kind" | "reason" | "gate">): string {
  switch (r.reason) {
    case "models_agree": return "Both models independently reached these findings from the selected sources.";
    case "conflicting_claims": return "The two models reached conflicting findings from the same sources. No single answer is given; both positions are shown with their conditions.";
    case "no_overlap": return "The two models cited different findings with no overlap, so nothing could be confirmed by both.";
    case "model_a_insufficient": return "Model A found the sources insufficient; Model B did not.";
    case "model_b_insufficient": return "Model B found the sources insufficient; Model A did not.";
    case "model_a_unverifiable": return "Every claim from Model A failed citation verification and was removed. Only Model B's verified claims remain.";
    case "model_b_unverifiable": return "Every claim from Model B failed citation verification and was removed. Only Model A's verified claims remain.";
    case "no_verifiable_claims": return "Every claim the models produced failed citation verification and was removed. Nothing could be shown without a verified source quote.";
    case "both_models_insufficient": return "Neither model found enough information in the selected sources to answer.";
    case "below_similarity_threshold": {
      const g = r.gate;
      const top = g?.top_similarity != null ? g.top_similarity.toFixed(2) : "n/a";
      return `No passage in the selected sources is similar enough to the question (best match ${top}, required ${g?.threshold.toFixed(2)}). The models were not asked.`;
    }
    case "integrity_failure": return "The stored source text no longer matches its checksum, so it was not used. Re-upload the affected documents.";
    case "no_source_chunks": return "The selected sources contain no searchable text.";
    default: return r.reason.replace(/_/g, " ");
  }
}

export const MATCH_LABEL: Record<string, string> = {
  exact: "Exact quote",
  normalized: "Quote matches (formatting differs)",
  fuzzy: "Approximate match",
};
