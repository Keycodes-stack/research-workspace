"use client";

import type { Editor } from "@tiptap/react";
import { useState, type ReactNode } from "react";

export const RIBBON_TABS = ["File", "Home", "Insert", "Layout", "Review", "View", "References"] as const;
export type RibbonTab = (typeof RIBBON_TABS)[number];

const FONTS = ["Arial", "Calibri", "Times New Roman", "Georgia", "Courier New", "Verdana"];
const ZOOMS = [90, 100, 110, 125];

/** One button of the ribbon: a label (or small icon text), a tooltip, and whether it is pressed. */
function Btn({ label, title, active, disabled, onClick, wide }: {
  label: ReactNode; title: string; active?: boolean; disabled?: boolean; onClick: () => void; wide?: boolean;
}) {
  return <button type="button" title={title} aria-label={title} aria-pressed={active} disabled={disabled} onClick={onClick}
    className={`${wide ? "min-w-[64px]" : "min-w-[32px]"} rounded-[6px] px-2 py-1 text-sm font-medium disabled:opacity-40 ${
      active ? "bg-[#E8EEFC] text-blue" : "text-[#344054] hover:bg-[#F2F4F7]"}`}>{label}</button>;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <div className="flex flex-col items-center gap-1 border-r border-[#EDEDF0] px-3 last:border-r-0">
    <div className="flex flex-wrap items-center justify-center gap-1">{children}</div>
    <span className="text-[11px] text-[#667085]">{title}</span>
  </div>;
}

export default function Ribbon({ editor, tab, onTab, zoom, onZoom, onComment, onDownload, saveLabel, pages, canComment }: {
  editor: Editor;
  tab: RibbonTab;
  onTab: (tab: RibbonTab) => void;
  zoom: number;
  onZoom: (zoom: number) => void;
  onComment: () => void;
  onDownload: () => void;
  saveLabel: string;
  pages: number;
  canComment: boolean;
}) {
  const [color, setColor] = useState("#101D37");
  const fontFamily = (editor.getAttributes("textStyle").fontFamily as string | undefined) ?? "";
  const inTable = editor.isActive("table");
  const chain = () => editor.chain().focus();

  return <div className="flex flex-col rounded-t-[12px] border border-b-0 border-[#EDEDF0] bg-white">
    <div role="tablist" aria-label="Ribbon" className="flex flex-wrap gap-1 border-b border-[#EDEDF0] px-2">
      {RIBBON_TABS.map((name) => <button key={name} type="button" role="tab" aria-selected={tab === name} onClick={() => onTab(name)}
        className={`px-3 py-2 text-sm font-medium ${tab === name ? "border-b-2 border-blue text-blue" : "text-[#344054] hover:text-[#101D37]"}`}>{name}</button>)}
    </div>

    <div role="toolbar" aria-label={`${tab} ribbon`} className="flex min-h-[84px] flex-wrap items-stretch gap-0 px-2 py-2">
      {tab === "File" && <>
        <Group title="Document">
          <Btn wide label="Download Word" title="Download Word document" onClick={onDownload} />
        </Group>
        <Group title="Status">
          <span className="px-2 text-sm text-[#667085]">{saveLabel}</span>
        </Group>
      </>}

      {tab === "Home" && <>
        <Group title="Clipboard">
          <Btn label="Undo" title="Undo" onClick={() => chain().undo().run()} />
          <Btn label="Redo" title="Redo" onClick={() => chain().redo().run()} />
        </Group>
        <Group title="Font">
          <select aria-label="Font family" value={fontFamily} onChange={(e) => (e.target.value ? chain().setFontFamily(e.target.value).run() : chain().unsetFontFamily().run())}
            className="h-8 rounded-[6px] border border-[#EDEDF0] bg-white px-2 text-sm text-[#101D37]">
            <option value="">Default font</option>
            {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <div className="flex gap-1">
            <Btn label={<b>B</b>} title="Bold" active={editor.isActive("bold")} onClick={() => chain().toggleBold().run()} />
            <Btn label={<i>I</i>} title="Italic" active={editor.isActive("italic")} onClick={() => chain().toggleItalic().run()} />
            <Btn label={<u>U</u>} title="Underline" active={editor.isActive("underline")} onClick={() => chain().toggleUnderline().run()} />
            <Btn label={<s>S</s>} title="Strikethrough" active={editor.isActive("strike")} onClick={() => chain().toggleStrike().run()} />
            <Btn label="x²" title="Superscript" active={editor.isActive("superscript")} onClick={() => chain().toggleSuperscript().run()} />
            <Btn label="x₂" title="Subscript" active={editor.isActive("subscript")} onClick={() => chain().toggleSubscript().run()} />
          </div>
        </Group>
        <Group title="Colour">
          <label className="flex items-center gap-1 text-xs text-[#344054]">Text
            <input type="color" aria-label="Text colour" value={color} onChange={(e) => { setColor(e.target.value); chain().setColor(e.target.value).run(); }} className="h-7 w-9 cursor-pointer rounded border border-[#EDEDF0]" />
          </label>
          <Btn label="Highlight" title="Highlight" active={editor.isActive("highlight")} onClick={() => chain().toggleHighlight({ color: "#FEF0C7" }).run()} wide />
        </Group>
        <Group title="Paragraph">
          <Btn label="• List" title="Bulleted list" active={editor.isActive("bulletList")} onClick={() => chain().toggleBulletList().run()} wide />
          <Btn label="1. List" title="Numbered list" active={editor.isActive("orderedList")} onClick={() => chain().toggleOrderedList().run()} wide />
          <Btn label="Left" title="Align left" active={editor.isActive({ textAlign: "left" })} onClick={() => chain().setTextAlign("left").run()} />
          <Btn label="Centre" title="Align centre" active={editor.isActive({ textAlign: "center" })} onClick={() => chain().setTextAlign("center").run()} />
          <Btn label="Right" title="Align right" active={editor.isActive({ textAlign: "right" })} onClick={() => chain().setTextAlign("right").run()} />
          <Btn label="Justify" title="Justify" active={editor.isActive({ textAlign: "justify" })} onClick={() => chain().setTextAlign("justify").run()} />
        </Group>
        <Group title="Styles">
          <Btn label="Normal" title="Normal text" active={editor.isActive("paragraph")} onClick={() => chain().setParagraph().run()} wide />
          <Btn label={<span className="text-base font-semibold">Heading 1</span>} title="Heading 1" active={editor.isActive("heading", { level: 1 })} onClick={() => chain().toggleHeading({ level: 1 }).run()} wide />
          <Btn label={<span className="font-semibold">Heading 2</span>} title="Heading 2" active={editor.isActive("heading", { level: 2 })} onClick={() => chain().toggleHeading({ level: 2 }).run()} wide />
          <Btn label={<span className="text-sm font-semibold">Heading 3</span>} title="Heading 3" active={editor.isActive("heading", { level: 3 })} onClick={() => chain().toggleHeading({ level: 3 }).run()} wide />
        </Group>
      </>}

      {tab === "Insert" && <>
        <Group title="Tables">
          <Btn label="Table 3×3" title="Insert a 3 by 3 table" onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} wide />
        </Group>
        <Group title="Table tools">
          <Btn label="Row" title="Add row below" disabled={!inTable} onClick={() => chain().addRowAfter().run()} />
          <Btn label="Column" title="Add column after" disabled={!inTable} onClick={() => chain().addColumnAfter().run()} />
          <Btn label="Delete table" title="Delete table" disabled={!inTable} onClick={() => chain().deleteTable().run()} wide />
        </Group>
        <Group title="Lines">
          <Btn label="Divider" title="Insert a horizontal line" onClick={() => chain().setHorizontalRule().run()} wide />
        </Group>
      </>}

      {tab === "Layout" && <>
        <Group title="Page">
          <span className="px-2 text-sm text-[#344054]">A4 · portrait</span>
        </Group>
        <Group title="Margins">
          <span className="px-2 text-sm text-[#344054]">2.5 cm all round</span>
        </Group>
      </>}

      {tab === "Review" && <>
        <Group title="Comments">
          <Btn label="New comment" title="Comment on the selected text" disabled={!canComment} onClick={onComment} wide />
        </Group>
        <Group title="Track changes">
          <span className="px-2 text-sm text-[#667085]">Not available yet</span>
        </Group>
      </>}

      {tab === "View" && <>
        <Group title="Zoom">
          <div className="flex gap-1">
            {ZOOMS.map((z) => <Btn key={z} label={`${z}%`} title={`Zoom ${z}%`} active={zoom === z} onClick={() => onZoom(z)} />)}
          </div>
        </Group>
        <Group title="Pages">
          <span className="px-2 text-sm text-[#344054]">{pages} page{pages === 1 ? "" : "s"}</span>
        </Group>
      </>}

      {tab === "References" && <Group title="References">
        <span className="px-2 text-sm text-[#667085]">Citations and bibliography are not available yet</span>
      </Group>}
    </div>
  </div>;
}
