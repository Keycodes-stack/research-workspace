export interface Segment { text: string; mark: boolean }

const ELLIPSIS = /\[\s*(?:\.\.\.|…)\s*\]|\.\.\.|…/;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Split `passage` into plain and highlighted parts for the (ellipsis-separated, ordered)
 *  `quote`. Matching ignores case and whitespace differences. Returns null when the quote
 *  cannot be located literally (e.g. it was accepted by the server's fuzzy matcher). */
export function highlight(passage: string, quote: string): Segment[] | null {
  const parts = quote.split(ELLIPSIS).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const ranges: [number, number][] = [];
  let pos = 0;
  for (const part of parts) {
    const words = part.split(/\s+/).map(escape);
    const re = new RegExp(words.join("\\s+"), "i");
    const m = re.exec(passage.slice(pos));
    if (!m) return null;
    const start = pos + m.index;
    ranges.push([start, start + m[0].length]);
    pos = start + m[0].length;
  }
  const out: Segment[] = [];
  let cursor = 0;
  for (const [a, b] of ranges) {
    if (a > cursor) out.push({ text: passage.slice(cursor, a), mark: false });
    out.push({ text: passage.slice(a, b), mark: true });
    cursor = b;
  }
  if (cursor < passage.length) out.push({ text: passage.slice(cursor), mark: false });
  return out;
}

export function pageLabel(start: number | null, end: number | null): string | null {
  if (start == null) return null;
  return end != null && end !== start ? `pp. ${start}–${end}` : `p. ${start}`;
}
