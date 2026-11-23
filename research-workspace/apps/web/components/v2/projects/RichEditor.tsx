"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { Mark, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { useEffect, useRef } from "react";

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

/** Only the formatting the server accepts (see validate_rich_document in services/ai/app/word_export.py). */
export const EDITOR_EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    blockquote: false, codeBlock: false, code: false, horizontalRule: false, strike: false,
  }),
  Underline,
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
  /** Anchor the comment to the text that was selected when "Comment" was pressed. */
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

function Toolbar({ editor, onComment }: { editor: Editor; onComment?: () => void }) {
  const button = (label: string, active: boolean, onClick: () => void, title: string, disabled = false) => (
    <button type="button" key={title} title={title} aria-label={title} aria-pressed={active} onClick={onClick} disabled={disabled}
      className={`min-w-8 rounded-md px-2 py-1 text-sm font-semibold disabled:opacity-40 ${active ? "bg-blue text-white" : "text-[#344054] hover:bg-[#F2F4F7]"}`}>{label}</button>
  );
  const hasSelection = !editor.state.selection.empty;
  return <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-1 border-b border-[#EDEDF0] pb-2">
    {button("B", editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), "Bold")}
    {button("I", editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), "Italic")}
    {button("U", editor.isActive("underline"), () => editor.chain().focus().toggleUnderline().run(), "Underline")}
    <span className="mx-1 h-5 w-px bg-[#EDEDF0]" />
    {button("H1", editor.isActive("heading", { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run(), "Heading 1")}
    {button("H2", editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), "Heading 2")}
    {button("H3", editor.isActive("heading", { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(), "Heading 3")}
    <span className="mx-1 h-5 w-px bg-[#EDEDF0]" />
    {button("• List", editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), "Bulleted list")}
    {button("1. List", editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), "Numbered list")}
    <span className="mx-1 h-5 w-px bg-[#EDEDF0]" />
    {onComment && button("Comment", false, onComment, "Comment on selected text", !hasSelection)}
    {button("Undo", false, () => editor.chain().focus().undo().run(), "Undo")}
    {button("Redo", false, () => editor.chain().focus().redo().run(), "Redo")}
  </div>;
}

/** Word-style editor. Changes are reported as JSON through onChange; comments are anchored to selected text. */
export default function RichEditor({ initial, onChange, disabled, onCommentRequest, onReady, resolvedIds }: {
  initial: JSONContent;
  onChange: (json: string) => void;
  disabled?: boolean;
  /** Called with the selected text when the user asks to comment on it. */
  onCommentRequest?: (selectedText: string) => void;
  onReady?: (api: EditorApi) => void;
  /** Comments already resolved: their anchors are shown faded. */
  resolvedIds?: string[];
}) {
  const range = useRef<{ from: number; to: number } | null>(null);
  const resolvedRef = useRef<string[]>(resolvedIds ?? []);
  resolvedRef.current = resolvedIds ?? [];

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
      onChange(JSON.stringify(changed.getJSON()));
      styleAnchors(changed);
    },
    onCreate: ({ editor: created }) => {
      styleAnchors(created);
      onReady?.({
        addCommentAnchor: (commentId: string) => {
          const selection = range.current;
          if (!selection) return;
          editor?.chain().focus().setTextSelection(selection).setMark("comment", { id: commentId }).run();
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

  const askComment = () => {
    const { from, to } = editor.state.selection;
    if (from === to) return;
    range.current = { from, to };
    onCommentRequest?.(editor.state.doc.textBetween(from, to, " "));
  };

  return <div className="flex flex-col gap-3">
    <Toolbar editor={editor} onComment={onCommentRequest ? askComment : undefined} />
    <EditorContent editor={editor} aria-label="Work package document"
      className="min-h-[50vh] rounded-[12px] border border-[#EDEDF0] bg-white p-4 text-sm leading-6 text-[#101D37] focus-within:border-blue [&_.ProseMirror]:min-h-[46vh] [&_.ProseMirror]:outline-none [&_.ProseMirror_h1]:text-2xl [&_.ProseMirror_h1]:font-semibold [&_.ProseMirror_h2]:text-xl [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h3]:text-lg [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6 [&_.comment-mark]:rounded-[3px] [&_.comment-mark]:bg-[#FEF0C7] [&_.comment-resolved]:bg-transparent [&_.comment-resolved]:text-[#98A2B3]" />
  </div>;
}
