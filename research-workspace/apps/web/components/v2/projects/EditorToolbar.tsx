"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  Bold01,
  Dotpoints02,
  FaceSmile,
  Italic01,
  Pilcrow01,
  Type02,
  Underline01,
} from "@untitledui/icons";
import { Add01Icon } from "@hugeicons/core-free-icons";
import Icon, { huge, untitled, type AnyIcon } from "@/components/v2/dashboard/Icon";

/**
 * Figma "Primary" toolbar: full width of the editor column, #FAFAFA, padding 9.51, border 0.79 #EDEDF0.
 * Icons 15.84px; gap 19.01 inside a group, 15.84 between groups.
 * Only formatting the server accepts is offered (see validate_rich_document): no links or images.
 */
const SIZES = ["10px", "12px", "14px", "16px", "20px", "24px", "30px"];
const EMOJIS = ["👍", "✅", "⚠️", "❗", "💡", "📌", "📈", "📉", "🔍", "📝", "⏳", "🚀"];

function Btn({ label, icon, active, onClick }: { label: string; icon: AnyIcon; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex size-[15.84px] shrink-0 items-center justify-center rounded-[3px] transition-colors ${
        active ? "text-blue" : "text-[#242C2C] hover:text-blue"
      }`}
    >
      <Icon icon={icon} size={15.84} stroke={1.3} />
    </button>
  );
}

function Popover({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      className="absolute top-6 left-1/2 z-40 -translate-x-1/2 rounded-[10px] border border-[#EDEDF0] bg-white p-1.5 shadow-[0_14px_30px_0_rgba(16,29,55,0.12)]"
    >
      {children}
    </div>
  );
}

export default function EditorToolbar({ editor }: { editor: Editor | null }) {
  const [menu, setMenu] = useState<null | "size" | "block" | "emoji">(null);

  /* re-render on every editor transaction so active states stay in sync */
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const rerender = () => setTick((t) => t + 1);
    editor.on("transaction", rerender);
    return () => {
      editor.off("transaction", rerender);
    };
  }, [editor]);

  const s = editor
    ? {
        bold: editor.isActive("bold"),
        italic: editor.isActive("italic"),
        underline: editor.isActive("underline"),
        left: editor.isActive({ textAlign: "left" }),
        center: editor.isActive({ textAlign: "center" }),
        list: editor.isActive("orderedList") || editor.isActive("bulletList"),
        h1: editor.isActive("heading", { level: 1 }),
        h2: editor.isActive("heading", { level: 2 }),
        size: (editor.getAttributes("textStyle").fontSize as string | undefined) || "",
      }
    : null;

  if (!editor || !s) return <div className="h-[34.85px]" />;
  const chain = () => editor.chain().focus();
  const close = () => setMenu(null);

  return (
    <div className="flex h-[34.85px] items-center overflow-x-auto border-[0.79px] border-[#EDEDF0] bg-[#FAFAFA] px-[9.51px] md:overflow-visible">
      <div className="flex items-center gap-[15.84px]">
        {/* Text */}
        <div className="flex items-center gap-[19.01px]">
          <Btn label="Bold" icon={untitled(Bold01)} active={s.bold} onClick={() => chain().toggleBold().run()} />
          <Btn label="Italic" icon={untitled(Italic01)} active={s.italic} onClick={() => chain().toggleItalic().run()} />
          <Btn label="Underline" icon={untitled(Underline01)} active={s.underline} onClick={() => chain().toggleUnderline().run()} />
          <div className="relative">
            <Btn label="Font size" icon={untitled(Type02)} active={!!s.size} onClick={() => setMenu(menu === "size" ? null : "size")} />
            <Popover open={menu === "size"} onClose={close}>
              <div className="flex w-24 flex-col">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { chain().setMark("textStyle", { fontSize: null }).run(); close(); }}
                  className="rounded-md px-2 py-1 text-left text-xs text-body hover:bg-[#F8F9FC]"
                >
                  Default
                </button>
                {SIZES.map((size) => (
                  <button
                    key={size}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { chain().setMark("textStyle", { fontSize: size }).run(); close(); }}
                    className={`rounded-md px-2 py-1 text-left text-xs hover:bg-[#F8F9FC] ${s.size === size ? "text-blue" : "text-[#242C2C]"}`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </Popover>
          </div>
        </div>

        {/* Paragraph */}
        <div className="flex items-center gap-[19.01px]">
          <Btn label="Align left" icon={untitled(AlignLeft)} active={s.left} onClick={() => chain().setTextAlign("left").run()} />
          <Btn label="Align center" icon={untitled(AlignCenter)} active={s.center} onClick={() => chain().setTextAlign("center").run()} />
          <Btn label="Numbered list" icon={untitled(Dotpoints02)} active={s.list} onClick={() => chain().toggleOrderedList().run()} />
          <div className="relative">
            <Btn label="Text style" icon={untitled(Pilcrow01)} active={s.h1 || s.h2} onClick={() => setMenu(menu === "block" ? null : "block")} />
            <Popover open={menu === "block"} onClose={close}>
              <div className="flex w-32 flex-col">
                {[
                  { label: "Paragraph", run: () => chain().setParagraph().run(), active: !s.h1 && !s.h2 },
                  { label: "Heading 1", run: () => chain().setHeading({ level: 1 }).run(), active: s.h1 },
                  { label: "Heading 2", run: () => chain().setHeading({ level: 2 }).run(), active: s.h2 },
                  { label: "Bullet list", run: () => chain().toggleBulletList().run(), active: false },
                ].map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { o.run(); close(); }}
                    className={`rounded-md px-2 py-1 text-left text-xs hover:bg-[#F8F9FC] ${o.active ? "text-blue" : "text-[#242C2C]"}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </Popover>
          </div>
        </div>

        {/* Insert */}
        <div className="flex items-center gap-[19.01px]">
          <div className="relative">
            <Btn label="Emoji" icon={untitled(FaceSmile)} onClick={() => setMenu(menu === "emoji" ? null : "emoji")} />
            <Popover open={menu === "emoji"} onClose={close}>
              <div className="grid w-[132px] grid-cols-6 gap-0.5">
                {EMOJIS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { chain().insertContent(em).run(); close(); }}
                    className="flex size-5 items-center justify-center rounded text-sm hover:bg-[#F8F9FC]"
                  >
                    {em}
                  </button>
                ))}
              </div>
            </Popover>
          </div>
          <Btn label="Insert divider" icon={huge(Add01Icon)} onClick={() => chain().setHorizontalRule().run()} />
        </div>
      </div>
    </div>
  );
}
