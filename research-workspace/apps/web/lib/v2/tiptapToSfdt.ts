/* Converts a work package's stored document into the Syncfusion editor's format (SFDT).
 * Documents saved before the editor change are tiptap JSON; plain text is one paragraph per line.
 * The section layout (page size, margins, styles) comes from the starter document. */
import { INITIAL_SFDT } from "@/lib/v2/workspaceSfdt";

type Inline = { text: string; characterFormat?: Record<string, unknown> };
type Block = { paragraphFormat: { styleName: string }; inlines: Inline[] };
type Sfdt = Record<string, unknown> & { sections: Record<string, unknown>[] };
type Node = { type?: string; text?: string; marks?: { type: string }[]; content?: Node[]; attrs?: { level?: number } };

function paragraph(styleName: string, inlines: Inline[], prefix = ""): Block {
  const all = prefix ? [{ text: prefix }, ...inlines] : inlines;
  return { paragraphFormat: { styleName }, inlines: all.length ? all : [{ text: "" }] };
}

/** A blank document with the starter document's page setup and styles, and none of its content or comments. */
function blankDocument(): Sfdt {
  const template = JSON.parse(INITIAL_SFDT) as Sfdt;
  const section = (template.sections[0] ?? {}) as Record<string, unknown>;
  return { ...template, comments: [], sections: [{ ...section, blocks: [paragraph("Normal", [])] }] };
}

function inlinesOf(node: Node): Inline[] {
  if (node.type === "text") {
    const format: Record<string, unknown> = {};
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") format.bold = true;
      if (mark.type === "italic") format.italic = true;
      if (mark.type === "underline") format.underline = "Single";
    }
    return [{ text: node.text ?? "", ...(Object.keys(format).length ? { characterFormat: format } : {}) }];
  }
  if (node.type === "hardBreak") return [{ text: "\v" }];
  return (node.content ?? []).flatMap(inlinesOf);
}

function blocksOf(node: Node, prefix = ""): Block[] {
  switch (node.type) {
    case "paragraph":
      return [paragraph("Normal", inlinesOf(node), prefix)];
    case "heading":
      return [paragraph(`Heading ${node.attrs?.level ?? 1}`, inlinesOf(node), prefix)];
    case "bulletList":
      return (node.content ?? []).flatMap((item) => (item.content ?? []).flatMap((c, i) => blocksOf(c, i === 0 ? "• " : "   ")));
    case "orderedList":
      return (node.content ?? []).flatMap((item, n) => (item.content ?? []).flatMap((c, i) => blocksOf(c, i === 0 ? `${n + 1}. ` : "   ")));
    case "table":
      return (node.content ?? []).map((row) => {
        const cells = (row.content ?? []).map((cell) => inlinesOf(cell));
        return paragraph("Normal", cells.flatMap((c, i) => (i ? [{ text: " | " }, ...c] : c)));
      });
    case "horizontalRule":
      return [paragraph("Normal", [])];
    default:
      return (node.content ?? []).flatMap((child) => blocksOf(child));
  }
}

/** Stored tiptap JSON (or null for an empty document) as SFDT. */
export function tiptapToSfdt(json: unknown): string {
  const doc = blankDocument();
  const root = (json ?? {}) as Node;
  const blocks = (root.content ?? []).flatMap((n) => blocksOf(n));
  if (blocks.length) doc.sections[0].blocks = blocks;
  return JSON.stringify(doc);
}

/** Plain text (one paragraph per line) as SFDT. */
export function plainToSfdt(text: string): string {
  const doc = blankDocument();
  doc.sections[0].blocks = (text || "").split("\n").map((line) => paragraph("Normal", line ? [{ text: line }] : []));
  return JSON.stringify(doc);
}
