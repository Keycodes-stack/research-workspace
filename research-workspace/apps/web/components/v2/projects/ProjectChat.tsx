"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  Add01Icon,
  Cancel01Icon,
  Clock01Icon,
  Image02Icon,
  Pdf02Icon,
  SentIcon,
} from "@hugeicons/core-free-icons";
import {
  MicButton,
  RecordingBar,
  VoiceChip,
  VoiceError,
  useDictation,
  withLive,
  appendText,
  type VoiceNote,
} from "@/components/v2/voice/Voice";
import Icon, { huge } from "@/components/v2/dashboard/Icon";
import { initialChats, type ChatMessage } from "@/lib/v2/design/projectScreens";
import { CURRENT_USER } from "@/lib/v2/design/workspaceDoc";

const ago = (iso: string, now: number) => {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
};

function Avatar({ name, src }: { name: string; src?: string }) {
  if (src)
    return (
      <Image
        src={src}
        alt=""
        width={36}
        height={36}
        className="size-[18px] shrink-0 rounded-full object-cover"
      />
    );
  return (
    <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-blue/10 text-[9px] font-semibold text-blue">
      {name[0]}
    </span>
  );
}

/** Figma "Project Chats" (card 885 wide, radius 16, padding 16; list and composer 30 apart;
 *  height = viewport − top bar 64 − padding 40/64 − title 36 − gap 20, so the page itself never scrolls): message bubbles (#FAFAFA, border #EDEDF0, radius 12), own messages on the right,
 *  composer "Write Here" with attach, mic and send. Messages are kept in this browser. */
export default function ProjectChat({ storageKey }: { storageKey: string }) {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [notes, setNotes] = useState<VoiceNote[]>([]);
  const rec = useDictation((t) => setText((p) => appendText(p, t)));
  const [now, setNow] = useState(() => Date.now());
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);

  /* load after mount (times depend on the clock, so never render them on the server) */
  useEffect(() => {
    let list: ChatMessage[] | null = null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) list = JSON.parse(raw);
    } catch {
      /* ignore damaged data */
    }
    setMsgs(Array.isArray(list) ? list : initialChats());
    loaded.current = true;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [storageKey]);

  /* keep the newest message in view */
  useEffect(() => {
    const el = listRef.current;
    if (el)
      el.scrollTo({
        top: el.scrollHeight,
        behavior: loaded.current ? "smooth" : "auto",
      });
  }, [msgs.length]);

  const send = (e?: React.FormEvent) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body && !files.length && !notes.length) return;
    const msg: ChatMessage = {
      id: `m${Date.now()}`,
      author: CURRENT_USER.name,
      avatar: CURRENT_USER.avatar,
      text: body,
      at: new Date().toISOString(),
      files: files.length ? files : undefined,
      voices: notes.length ? notes : undefined,
      mine: true,
    };
    const next = [...msgs, msg];
    setMsgs(next);
    setNow(Date.now());
    setText("");
    setFiles([]);
    setNotes([]);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* storage full */
    }
  };

  return (
    <section className="flex h-[calc(100dvh-224px)] min-h-[480px] w-full flex-col gap-[30px] rounded-2xl border border-[#EDEDF0] bg-white p-4">
      <div
        ref={listRef}
        className="chat-scroll flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-2.5"
        aria-live="polite"
      >
        {msgs.map((m) => (
          <div
            key={m.id}
            className={`flex max-w-[85%] flex-col gap-2.5 rounded-xl border border-[#EDEDF0] bg-[#FAFAFA] px-2.5 py-2 sm:max-w-[70%] ${
              m.mine ? "self-end" : "self-start"
            }`}
          >
            {m.files && (
              <div className="flex flex-wrap gap-2">
                {m.files.map((f) => (
                  <span
                    key={f}
                    title={f}
                    className="flex size-9 items-center justify-center rounded-lg border border-[#EDEDF0] bg-white text-[#101D37]"
                  >
                    <Icon
                      icon={huge(/\.pdf$/i.test(f) ? Pdf02Icon : Image02Icon)}
                      size={16}
                      stroke={1.4}
                    />
                  </span>
                ))}
              </div>
            )}
            {m.voices && (
              <div className="flex flex-col gap-1.5">
                {m.voices.map((v) => (
                  <VoiceChip key={v.id} note={v} compact />
                ))}
              </div>
            )}
            {m.text && (
              <p className="text-xs leading-[1.5] tracking-[-0.02em] break-words text-[#101D37]">
                {m.text}
              </p>
            )}
            <div className="flex items-center gap-2.5">
              <span className="flex items-center gap-1">
                <Avatar name={m.author} src={m.avatar} />
                <span className="text-xs leading-[1.5] font-medium tracking-[-0.02em] text-[#101D37]">
                  {m.mine ? "You" : m.author}
                </span>
              </span>
              <span className="flex items-center gap-1 text-[10px] leading-[1.5] tracking-[-0.02em] text-body">
                <Icon icon={huge(Clock01Icon)} size={12} stroke={1.4} />
                {ago(m.at, now)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <form
        onSubmit={send}
        className="flex shrink-0 flex-col gap-2 rounded-xl border border-[#EDEDF0] bg-[#FAFAFA] p-2.5"
      >
        {notes.length > 0 && (
          <div className="flex flex-wrap gap-2 px-1">
            {notes.map((n) => (
              <VoiceChip
                key={n.id}
                note={n}
                compact
                onRemove={() => setNotes((l) => l.filter((x) => x.id !== n.id))}
              />
            ))}
          </div>
        )}
        <VoiceError rec={rec} />
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 px-1">
            {files.map((f, i) => (
              <span
                key={`${f}-${i}`}
                className="flex h-7 max-w-[200px] items-center gap-1.5 rounded-lg border border-[#EDEDF0] bg-white px-2 text-[11px] text-[#242C2C]"
              >
                <span className="truncate">{f}</span>
                <button
                  type="button"
                  aria-label={`Remove ${f}`}
                  onClick={() =>
                    setFiles((all) => all.filter((_, j) => j !== i))
                  }
                  className="text-body"
                >
                  <Icon icon={huge(Cancel01Icon)} size={12} stroke={1.4} />
                </button>
              </span>
            ))}
          </div>
        )}
        {rec.active && (
          <div className="px-1">
            <RecordingBar rec={rec} caption={false} />
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Attach files"
            onClick={() => fileRef.current?.click()}
            className="flex size-8 shrink-0 items-center justify-center text-body hover:text-[#101D37]"
          >
            <Icon icon={huge(Add01Icon)} size={16} stroke={1.4} />
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            accept="image/*,application/pdf"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []).map(
                (f) => f.name,
              );
              setFiles((all) => [...all, ...picked]);
              e.target.value = "";
            }}
          />
          <textarea
            rows={1}
            value={withLive(text, rec)}
            readOnly={rec.active}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              /* Enter sends, Shift+Enter adds a new line */
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Write Here"
            aria-label="Message"
            className="block min-h-9 min-w-0 flex-1 bg-transparent py-2 text-sm leading-5 text-[#101D37] outline-none placeholder:text-body [field-sizing:content] max-h-[200px] resize-none overflow-y-auto"
          />
          {!rec.active && !rec.transcribing && (
            <MicButton rec={rec} size={32} />
          )}
          <button
            type="submit"
            aria-label="Send"
            disabled={
              (!text.trim() && !files.length && !notes.length) || rec.active
            }
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue text-white disabled:opacity-40"
          >
            <Icon icon={huge(SentIcon)} size={15} stroke={1.5} />
          </button>
        </div>
      </form>
    </section>
  );
}
