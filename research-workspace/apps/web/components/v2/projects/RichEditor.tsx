"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { Mark, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextStyle from "@tiptap/extension-text-style";
import FontFamily from "@tiptap/extension-font-family";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { useEffect, useRef } from "react";
import EditorToolbar from "@/components/v2/projects/EditorToolbar";

/**
 * A comment anchor: the selected text carries a mark with the comment's id (as Google Docs anchors comments
 * to text). The server accepts this mark only with an id (see validate_rich_document).
 */
export const CommentAnchor = Mark.create({
  name: "comment",
  inclusive: false,
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-comment-id"),
        renderHTML: (attrs) => (attrs.id ? { "data-comment-id": attrs.id } : {}),
      },
    };
  },
  parseHTML() { return [{ tag: "mark[data-comment-id]" }]; },
  renderHTML({ HTMLAttributes }) { return ["mark", mergeAttributes({ class: "comment-mark" }, HTMLAttributes), 0]; },
});

/** Text style with a font size (the toolbar's size menu). The server accepts fontSize inside textStyle. */
const SizedTextStyle = TextStyle.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fontSize: {
        default: null,
        parseHTML: (el) => el.style.fontSize || null,
        renderHTML: (attrs) => (attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {}),
      },
    };
  },
});

/** Every formatting option the editor can store. The server accepts exactly these (see validate_rich_document). */
export const EDITOR_EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    blockquote: false, codeBlock: false, code: false,
  }),
  Underline,
  SizedTextStyle,
  FontFamily,
  Color,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  Subscript,
  Superscript,
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  CommentAnchor,
];

type JSONContent = Record<string, unknown>;

/** Ids of the comments anchored in a stored document (used to show orphaned comments). */
export function commentIdsIn(json: string): Set<string> {
  const ids = new Set<string>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as { marks?: { type?: string; attrs?: { id?: unknown } }[]; content?: unknown[] };
    for (const mark of n.marks ?? []) if (mark.type === "comment" && typeof mark.attrs?.id === "string") ids.add(mark.attrs.id);
    for (const child of n.content ?? []) walk(child);
  };
  try { walk(JSON.parse(json || "null")); } catch { /* not a document yet */ }
  return ids;
}

/** The text range carrying a comment's anchor, or null when the text is not in the document. */
function anchorRange(editor: Editor, commentId: string): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found || !node.isText) return;
    if (node.marks.some((m) => m.type.name === "comment" && m.attrs.id === commentId)) {
      found = { from: pos, to: pos + node.nodeSize };
    }
  });
  return found;
}

/** Operations the workspace page uses on the editor. */
export type EditorApi = {
  /** "New" in the comments panel: quote the current selection ("" when nothing is selected). */
  beginComment: () => void;
  /** Anchor the comment to the text that was selected when "New" was pressed. */
  addCommentAnchor: (commentId: string) => void;
  /** Move the cursor to a comment's text and scroll there. */
  focusComment: (commentId: string) => void;
  /** Remove a comment's highlight from the text (when the comment is deleted). */
  removeCommentAnchor: (commentId: string) => void;
};

/** Content of a stored document: structured JSON, or plain text converted to paragraphs. */
export function toEditorContent(format: string, body: string): JSONContent {
  if (format === "tiptap") {
    try {
      const parsed = JSON.parse(body || "null") as JSONContent | null;
      if (parsed && parsed.type === "doc") return parsed;
    } catch { /* fall through to an empty document */ }
    return { type: "doc", content: [{ type: "paragraph" }] };
  }
  const lines = (body || "").split("\n");
  return {
    type: "doc",
    content: lines.map((line) => (line ? { type: "paragraph", content: [{ type: "text", text: line }] } : { type: "paragraph" })),
  };
}

/**
 * Figma "Workspace" editor: the formatting toolbar above a white A4 sheet (595 wide, border #EDEDF0, 40px inner padding).
 * Changes are reported as JSON through onChange.
 */
export default function RichEditor({ initial, onChange, disabled, onCommentRequest, onReady, resolvedIds }: {
  initial: JSONContent;
  onChange: (json: string) => void;
  disabled?: boolean;
  /** Called with the selected text when the user asks to comment on it ("" when nothing is selected). */
  onCommentRequest?: (selectedText: string) => void;
  onReady?: (api: EditorApi) => void;
  /** Comments already resolved: their anchors are shown faded. */
  resolvedIds?: string[];
}) {
  const range = useRef<{ from: number; to: number } | null>(null);
  const resolvedRef = useRef<string[]>(resolvedIds ?? []);
  resolvedRef.current = resolvedIds ?? [];
  const requestRef = useRef(onCommentRequest);
  requestRef.current = onCommentRequest;
  // The content as it was when the editor opened: opening a document is not an edit, so it is not saved.
  const baseline = useRef("");

  const styleAnchors = (editor: Editor) => {
    const resolved = new Set(resolvedRef.current);
    editor.view.dom.querySelectorAll("mark.comment-mark").forEach((mark) => {
      mark.classList.toggle("comment-resolved", resolved.has(mark.getAttribute("data-comment-id") ?? ""));
    });
  };

  const editor = useEditor({
    extensions: EDITOR_EXTENSIONS,
    content: initial,
    editable: !disabled,
    immediatelyRender: false,
    onUpdate: ({ editor: changed }) => {
      const json = JSON.stringify(changed.getJSON());
      styleAnchors(changed);
      if (json !== baseline.current) onChange(json);
    },
    onCreate: ({ editor: created }) => {
      baseline.current = JSON.stringify(created.getJSON());
      styleAnchors(created);
      onReady?.({
        beginComment: () => {
          const { from, to, empty } = created.state.selection;
          if (empty) {
            range.current = null;
            requestRef.current?.("");
            return;
          }
          range.current = { from, to };
          requestRef.current?.(created.state.doc.textBetween(from, to, " "));
        },
        addCommentAnchor: (commentId: string) => {
          const selection = range.current;
          if (!selection) return;
          created.chain().focus().setTextSelection(selection).setMark("comment", { id: commentId }).run();
          range.current = null;
        },
        focusComment: (commentId: string) => {
          const found = anchorRange(created, commentId);
          if (found) created.chain().focus().setTextSelection(found).scrollIntoView().run();
        },
        removeCommentAnchor: (commentId: string) => {
          const found = anchorRange(created, commentId);
          if (found) created.chain().setTextSelection(found).unsetMark("comment").run();
        },
      });
    },
  });

  useEffect(() => { editor?.setEditable(!disabled); }, [editor, disabled]);
  useEffect(() => { if (editor) styleAnchors(editor); }, [editor, resolvedIds]);

  if (!editor) return <div className="min-h-[50vh] rounded-[12px] border border-[#EDEDF0] p-4 text-sm text-[#667085]">Loading editor…</div>;

  return <>
    <div className="mt-[31px]">
      <EditorToolbar editor={editor} />
    </div>
    <div className="flex justify-center px-4 pt-10 pb-16 sm:px-6">
      <div className="min-h-[842px] w-full max-w-[595px] border border-[#EDEDF0] bg-white p-6 sm:p-10">
        <EditorContent editor={editor} aria-label="Work package document"
          className="text-[13px] leading-[1.6] text-[#101D37] [&_.ProseMirror]:min-h-[700px] [&_.ProseMirror]:outline-none [&_.ProseMirror_h1]:mb-3 [&_.ProseMirror_h1]:text-[22px] [&_.ProseMirror_h1]:font-semibold [&_.ProseMirror_h2]:mt-5 [&_.ProseMirror_h2]:mb-2 [&_.ProseMirror_h2]:text-[17px] [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h3]:mt-4 [&_.ProseMirror_h3]:text-[15px] [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_p]:mb-2 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6 [&_.ProseMirror_table]:w-full [&_.ProseMirror_table]:border-collapse [&_.ProseMirror_td]:border [&_.ProseMirror_td]:border-[#D0D5DD] [&_.ProseMirror_td]:p-2 [&_.ProseMirror_th]:border [&_.ProseMirror_th]:border-[#D0D5DD] [&_.ProseMirror_th]:bg-[#F8FAFC] [&_.ProseMirror_th]:p-2 [&_.ProseMirror_th]:text-left [&_.ProseMirror_hr]:my-4 [&_.ProseMirror_hr]:border-[#D0D5DD] [&_.comment-mark]:rounded-[3px] [&_.comment-mark]:bg-[#FEF0C7] [&_.comment-resolved]:bg-transparent [&_.comment-resolved]:text-[#98A2B3]" />
        <button
          type="button"
          disabled={disabled}
          onClick={() => editor.chain().focus("end").insertContent("<h2>New Section</h2><p></p>").run()}
          className="mt-[30px] flex items-center gap-1.5 text-xs leading-[1.5] font-medium tracking-[-0.02em] text-blue disabled:opacity-40"
        >
          + Add Section
        </button>
      </div>
    </div>
  </>;
}
