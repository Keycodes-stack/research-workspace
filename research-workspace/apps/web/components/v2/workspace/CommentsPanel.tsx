"use client";

import Image from "next/image";
import { useState } from "react";
import { Add01Icon, ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import Icon, { huge } from "@/components/v2/dashboard/Icon";
import { CURRENT_USER, type Comment } from "@/lib/v2/workspaceDoc";

/**
 * Figma comments panel: 215 wide, white, left border #EDEDF0.
 *  Header "Comments" Inter 600 16 #101D37 + "+ New" Inter 500 12 #285CE0
 *  Card: avatar 30, name Inter 500 14 #101D37, time Inter 10 #667085,
 *        quote box #FAFAFA radius 12 border #EDEDF0 padding 8/10, text 10 #667085
 *        (active: border #285CE0 30%, text #285CE0), body Inter 12 #667085,
 *        "Reply" Inter 600 10 #285CE0, "Resolve" Inter 600 10 #667085
 */
function Avatar({ src, name }: { src: string; name: string }) {
  if (!src)
    return (
      <span
        aria-label={name}
        className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-[#F2F4F7] text-[11px] font-semibold text-[#475467]"
      >
        {name
          .split(" ")
          .map((w) => w[0])
          .join("")
          .slice(0, 2)
          .toUpperCase()}
      </span>
    );
  return (
    <Image
      src={src}
      alt={name}
      width={30}
      height={30}
      className="size-[30px] shrink-0 rounded-full bg-[#C4C4C4]"
    />
  );
}

export default function CommentsPanel({
  comments,
  activeId,
  draftQuote,
  onFocus,
  onStartNew,
  onCancelNew,
  onCreate,
  onReply,
  onResolve,
}: {
  comments: Comment[];
  activeId: string | null;
  draftQuote: string | null;
  onFocus: (id: string) => void;
  onStartNew: () => void;
  onCancelNew: () => void;
  onCreate: (body: string) => void;
  onReply: (id: string, body: string) => void;
  onResolve: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [reply, setReply] = useState("");

  const open = comments.filter((c) => !c.resolved);

  return (
    <aside className="flex h-full w-[215px] shrink-0 flex-col border-l border-[#EDEDF0] bg-white">
      <div className="flex items-center justify-between px-4 pt-5 pb-3">
        <h2 className="text-base leading-[1.5] font-semibold tracking-[-0.02em] text-[#101D37]">
          Comments
        </h2>
        <button
          type="button"
          onClick={onStartNew}
          className="flex items-center gap-1 text-xs leading-[1.5] font-medium tracking-[-0.02em] text-[#344054]"
        >
          <Icon icon={huge(Add01Icon)} size={13} stroke={1.1} />
          New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {draftQuote !== null && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.trim()) return;
              onCreate(draft.trim());
              setDraft("");
            }}
            className="flex flex-col gap-2.5 border-b border-[#EDEDF0] px-4 py-3"
          >
            <div className="flex items-center gap-2">
              <Avatar src={CURRENT_USER.avatar} name={CURRENT_USER.name} />
              <p className="text-sm leading-[1.5] font-medium tracking-[-0.02em] text-[#101D37]">
                {CURRENT_USER.name}
              </p>
            </div>
            {draftQuote ? (
              <p className="rounded-xl border border-[#D0D5DD] bg-[#FAFAFA] px-2.5 py-2 text-[10px] leading-[1.5] tracking-[-0.02em] text-[#344054]">
                {draftQuote}
              </p>
            ) : (
              <p className="text-[10px] leading-[1.5] text-body">
                Select text in the document to attach this comment to it.
              </p>
            )}
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              placeholder="Write a comment…"
              className="w-full resize-none rounded-lg border border-[#EDEDF0] bg-white px-2 py-1.5 text-xs leading-[1.5] tracking-[-0.02em] text-[#101D37] outline-none placeholder:text-body focus:border-[#98A2B3]"
            />
            <div className="flex items-center gap-3 text-[10px] leading-[1.5] font-semibold tracking-[-0.02em]">
              <button type="submit" disabled={!draftQuote || !draft.trim()} className="text-[#344054] disabled:opacity-40">
                Comment
              </button>
              <button type="button" onClick={onCancelNew} className="text-body">
                Cancel
              </button>
            </div>
          </form>
        )}

        {open.length === 0 && draftQuote === null && (
          <p className="px-4 py-6 text-xs leading-[1.5] text-body">
            No open comments. Select text and click “New”.
          </p>
        )}

        {open.map((c) => {
          const active = c.id === activeId;
          return (
            <article
              key={c.id}
              className="flex flex-col gap-2.5 border-b border-[#EDEDF0] px-4 py-4"
            >
              <div className="flex items-center gap-2">
                <Avatar src={c.avatar} name={c.author} />
                <div className="min-w-0">
                  <p className="truncate text-sm leading-[1.5] font-medium tracking-[-0.02em] text-[#101D37]">
                    {c.author}
                  </p>
                  <p className="text-[10px] leading-[1.5] tracking-[-0.02em] text-body">
                    {c.time}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onFocus(c.id)}
                className={`flex items-start gap-1.5 rounded-xl border bg-[#FAFAFA] px-2.5 py-2 text-left text-[10px] leading-[1.5] tracking-[-0.02em] transition-colors ${
                  active ? "border-[#98A2B3] text-[#344054]" : "border-[#EDEDF0] text-body hover:border-[#98A2B3]"
                }`}
              >
                <span className="flex-1">{c.quote}</span>
                <Icon icon={huge(ArrowUpRight01Icon)} size={12} stroke={1.1} className="mt-0.5 shrink-0 text-[#101D37]" />
              </button>

              <p className="text-xs leading-[1.5] tracking-[-0.02em] text-body">{c.body}</p>

              {c.replies.map((r) => (
                <div key={r.id} className="ml-2 flex flex-col gap-1 border-l-2 border-[#EDEDF0] pl-2">
                  <p className="text-[10px] leading-[1.5] font-semibold tracking-[-0.02em] text-[#101D37]">
                    {r.author} <span className="font-normal text-body">· {r.time}</span>
                  </p>
                  <p className="text-xs leading-[1.5] tracking-[-0.02em] text-body">{r.body}</p>
                </div>
              ))}

              {replyFor === c.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!reply.trim()) return;
                    onReply(c.id, reply.trim());
                    setReply("");
                    setReplyFor(null);
                  }}
                  className="flex flex-col gap-1.5"
                >
                  <textarea
                    autoFocus
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    rows={2}
                    placeholder="Reply…"
                    className="w-full resize-none rounded-lg border border-[#EDEDF0] px-2 py-1.5 text-xs leading-[1.5] text-[#101D37] outline-none placeholder:text-body focus:border-[#98A2B3]"
                  />
                  <div className="flex gap-3 text-[10px] leading-[1.5] font-semibold">
                    <button type="submit" className="text-[#344054]">Send</button>
                    <button type="button" onClick={() => setReplyFor(null)} className="text-body">Cancel</button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center gap-2 text-[10px] leading-[1.5] font-semibold tracking-[-0.02em]">
                  <button type="button" onClick={() => { setReplyFor(c.id); setReply(""); }} className="text-[#344054]">
                    Reply
                  </button>
                  <button type="button" onClick={() => onResolve(c.id)} className="text-body hover:text-[#101D37]">
                    Resolve
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </aside>
  );
}
