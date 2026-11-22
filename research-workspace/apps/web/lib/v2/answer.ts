import type { AskResult, ChunkMeta } from "@/lib/types";

/** One cited paper or upload: its number in the answer, and every passage of it the answer quotes. */
export interface CitedSource {
  n: number;
  title: string;
  origin: string;
  doi: string | null;
  url: string | null;
  passages: { chunkId: string; quote: string; pages: string; text: string }[];
}

const ORIGIN: Record<string, string> = {
  user_upload: "Uploaded PDF",
  openalex: "Found via OpenAlex",
  europe_pmc: "Found via Europe PMC",
  unpaywall: "Found via Unpaywall",
};

/** A title a person can read: never a DOI suffix or a file extension (the DOI is shown on its own). */
export function readableTitle(label: string): string {
  return label.replace(/,\s*doi:\S+\s*$/i, "").replace(/\.pdf$/i, "").trim() || "Untitled source";
}

export function pageLabel(m: Pick<ChunkMeta, "page_start" | "page_end">): string {
  if (m.page_start == null) return "";
  return m.page_end != null && m.page_end !== m.page_start ? `pp. ${m.page_start}–${m.page_end}` : `p. ${m.page_start}`;
}

/**
 * Numbers the sources an answer cites, in order of first citation (one number per paper, not per passage), and
 * returns `refs(chunkIds, quote)`: the numbers to show after a claim. Passages missing from `chunks` are skipped.
 */
export function citeSources(chunks: AskResult["chunks"]) {
  const bySource = new Map<string, CitedSource>();
  const refs = (chunkIds: string[], quote: string): number[] => {
    const out: number[] = [];
    for (const id of chunkIds) {
      const m = chunks[id];
      if (!m) continue;
      let s = bySource.get(m.source_id);
      if (!s) {
        s = {
          n: bySource.size + 1, title: readableTitle(m.label), origin: ORIGIN[m.origin ?? ""] ?? "Source",
          doi: m.doi, url: m.url ?? (m.doi ? `https://doi.org/${m.doi}` : null), passages: [],
        };
        bySource.set(m.source_id, s);
      }
      if (!s.passages.some((p) => p.chunkId === id && p.quote === quote)) {
        s.passages.push({ chunkId: id, quote, pages: pageLabel(m), text: m.text });
      }
      if (!out.includes(s.n)) out.push(s.n);
    }
    return out;
  };
  return { refs, sources: () => [...bySource.values()] };
}

/** "INSUFFICIENT_SOURCE_EVIDENCE: the sources …" -> "The sources …" (the server's machine prefix is not for people). */
export function plainContent(content: string): string {
  return content.replace(/^INSUFFICIENT_SOURCE_EVIDENCE:\s*(.)/, (_, c: string) => c.toUpperCase()).trim();
}

/** One line on how the answer was found: where from, how much was read, what was verified, how long it took. */
export function answerFacts(r: AskResult): string[] {
  const g = r.gate;
  const facts: string[] = [];
  if (g.evidence_from === "online_search") {
    const found = g.online?.found;
    facts.push(found != null ? `New online search: ${found} papers found, ${g.online?.stored ?? 0} stored` : "New online search");
  } else if (g.evidence_from === "saved_sources") {
    facts.push(`From this project's ${g.saved_sources ?? 0} saved sources`);
  }
  if (g.papers_read != null) facts.push(`${g.papers_read} source${g.papers_read === 1 ? "" : "s"} read`);
  const v = r.verification;
  facts.push(`${v.verified} claim${v.verified === 1 ? "" : "s"} verified` + (v.purged ? `, ${v.purged} removed` : ""));
  if (r.timings?.total_s != null) facts.push(`${r.timings.total_s} s`);
  return facts;
}
