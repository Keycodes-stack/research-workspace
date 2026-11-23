/* Starting document for the Syncfusion editor, in its SFDT (JSON) format.
 * Same content and comments as the Figma frame "Projects - Workspace". */

type Inline = { text: string } | { commentCharacterType: 0 | 1; commentId: string };
type Block = { paragraphFormat?: { styleName: string }; inlines: Inline[] };

const p = (styleName: string, ...inlines: Inline[]): Block => ({ paragraphFormat: { styleName }, inlines });
const t = (text: string): Inline => ({ text });
/** wraps text in a comment range */
const c = (id: string, text: string): Inline[] => [
  { commentCharacterType: 0, commentId: id },
  { text },
  { commentCharacterType: 1, commentId: id },
];

const INK = "#101D37";
const BODY = "#667085";

export const INITIAL_SFDT = JSON.stringify({
  sections: [
    {
      sectionFormat: {
        pageWidth: 595.3,
        pageHeight: 841.9,
        leftMargin: 56.7,
        rightMargin: 56.7,
        topMargin: 56.7,
        bottomMargin: 56.7,
        headerDistance: 36,
        footerDistance: 36,
      },
      blocks: [
        p("Title", t("Storage Technologies")),
        p("Subtitle", t("Working research · Technical Feasibility Assessment · Ibrahim Ghatila and contributors")),
        p("Heading 1", t("Research Objective")),
        p(
          "Normal",
          t("Evaluate technical feasibility, operating requirements, safety and commercial suitability of hydrogen storage alternatives."),
        ),
        p("Heading 1", t("1. Background")),
        p(
          "Normal",
          t(
            "Hydrogen storage technologies vary in maturity, efficiency, operating conditions and infrastructure requirements. This research compares available methods against industrial deployment needs.",
          ),
        ),
        p("Heading 1", t("2. Technical Assessment")),
        p(
          "Normal",
          t("Initial research considers compressed gas, liquefied hydrogen and material-based storage approaches. "),
          ...c("c2", "Each has different technical and operational constraints."),
          t(" "),
          ...c("c1", "Comparative evidence remains under review."),
        ),
        p("Heading 1", t("3. Open Questions")),
        p("List Paragraph", t("What are the comparative lifecycle costs?")),
        p("List Paragraph", t("Which alternatives meet the relevant safety requirements?")),
        p("List Paragraph", t("What infrastructure would each approach require?")),
      ],
      headersFooters: {},
    },
  ],
  characterFormat: { fontFamily: "Arial", fontSize: 10.5, fontColor: BODY },
  paragraphFormat: { afterSpacing: 8, lineSpacing: 1.4, lineSpacingType: "Multiple" },
  styles: [
    {
      name: "Normal",
      type: "Paragraph",
      paragraphFormat: { afterSpacing: 8, lineSpacing: 1.4, lineSpacingType: "Multiple" },
      characterFormat: { fontFamily: "Arial", fontSize: 10.5, fontColor: BODY },
      next: "Normal",
    },
    { name: "Default Paragraph Font", type: "Character", characterFormat: {} },
    {
      name: "Title",
      type: "Paragraph",
      basedOn: "Normal",
      next: "Subtitle",
      paragraphFormat: { afterSpacing: 6, lineSpacing: 1, lineSpacingType: "Multiple" },
      characterFormat: { fontSize: 24, bold: true, fontColor: INK },
    },
    {
      name: "Subtitle",
      type: "Paragraph",
      basedOn: "Normal",
      next: "Normal",
      paragraphFormat: { afterSpacing: 18 },
      characterFormat: { fontSize: 9.5, fontColor: BODY },
    },
    {
      name: "Heading 1",
      type: "Paragraph",
      basedOn: "Normal",
      next: "Normal",
      paragraphFormat: { beforeSpacing: 16, afterSpacing: 6, outlineLevel: "Level1", keepWithNext: true },
      characterFormat: { fontSize: 15, bold: true, fontColor: INK },
    },
    {
      name: "Heading 2",
      type: "Paragraph",
      basedOn: "Normal",
      next: "Normal",
      paragraphFormat: { beforeSpacing: 12, afterSpacing: 4, outlineLevel: "Level2", keepWithNext: true },
      characterFormat: { fontSize: 12.5, bold: true, fontColor: INK },
    },
    {
      name: "List Paragraph",
      type: "Paragraph",
      basedOn: "Normal",
      next: "List Paragraph",
      paragraphFormat: { leftIndent: 18, afterSpacing: 4 },
      characterFormat: {},
    },
  ],
  comments: [
    {
      commentId: "c1",
      author: "Ibrahim Ghatila",
      initial: "IG",
      date: "2026-11-17T10:30:00",
      done: false,
      blocks: [{ inlines: [{ text: "Can we add a comparison of operating pressures and energy requirements?" }] }],
      replyComments: [],
    },
    {
      commentId: "c2",
      author: "Omar Patel",
      initial: "OP",
      date: "2026-11-17T10:30:00",
      done: false,
      blocks: [{ inlines: [{ text: "We should validate the cost assumptions against another source." }] }],
      replyComments: [],
    },
  ],
});
