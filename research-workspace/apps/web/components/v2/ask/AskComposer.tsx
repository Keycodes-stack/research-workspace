"use client";

import { useRef, useState, type ReactNode } from "react";
import { Folder, Send03 } from "@untitledui/icons";
import { Add01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import Icon, { huge, untitled } from "@/components/v2/dashboard/Icon";
import Picker, { type PickerOption } from "./Picker";
import { ModelsPicker, ReasoningPicker, SourcesPicker } from "@/components/v2/knowledge/ResearchPickers";
import { api } from "@/lib/api";
import type { EvidenceScope } from "@/lib/types";
import { MicButton, RecordingBar, VoiceError, appendText, useDictation, withLive } from "@/components/v2/voice/Voice";

type Upload = { key: string; name: string; state: "uploading" | "added" | "failed"; error?: string };

/**
 * Design: the Home "prompt card" (radius 20, padding 20, blue shadow): an input with "+", then Evidence Sources on the
 * left and mic + send on the right. "+" uploads PDFs to the project at once (they are chunked and embedded on upload,
 * so every later question can use them). The mic dictates into the box, same as the reference Home prompt.
 */
export default function AskComposer({
  projectId, projects, onProjectChange, onCreateProject, scope, onScopeChange, busy, onAsk,
  placeholder = "Describe a question, research objective or decision to make..",
  thread,
}: {
  /** the conversation, shown inside this box above the input (Home): the box grows and its thread scrolls */
  thread?: ReactNode;
  projectId: string | null;
  /** when given, a project picker is shown (Home); the chat page passes none */
  projects?: PickerOption<string>[];
  onProjectChange?: (id: string) => void;
  /** when given, a "New project" button sits by the project picker (Home) */
  onCreateProject?: () => void;
  scope: EvidenceScope;
  onScopeChange: (s: EvidenceScope) => void;
  busy: boolean;
  onAsk: (question: string) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const rec = useDictation((t) => setText((p) => appendText(p, t)));
  const uploading = uploads.some((u) => u.state === "uploading");
  const question = text.trim();
  const canAsk = !!projectId && question.length >= 3 && !busy && !uploading && !rec.active;

  const upload = async (files: File[]) => {
    if (!projectId) return;
    for (const file of files) {
      const key = `${file.name}-${file.size}-${Date.now()}`;
      setUploads((all) => [...all, { key, name: file.name, state: "uploading" }]);
      try {
        await api.upload(projectId, file);
        setUploads((all) => all.map((u) => (u.key === key ? { ...u, state: "added" } : u)));
      } catch (e) {
        const error = e instanceof Error ? e.message : "Upload failed";
        setUploads((all) => all.map((u) => (u.key === key ? { ...u, state: "failed", error } : u)));
      }
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canAsk) return;
        onAsk(question);
        setText("");
        setUploads((all) => all.filter((u) => u.state !== "added"));
      }}
      className="flex flex-col gap-4 rounded-[20px] border border-[#EDEDF0] bg-white p-5 shadow-[0_14px_30px_0_rgba(40,92,224,0.10)]"
    >
      {thread}
      {projects && onProjectChange && (
        <div className="flex flex-wrap items-center gap-2">
          <Picker
            icon={untitled(Folder)}
            label="Project"
            value={projectId}
            options={projects}
            onChange={onProjectChange}
            emptyText="No project can take questions yet. Create an open-discovery project first."
          />
          {onCreateProject && (
            <button
              type="button"
              onClick={onCreateProject}
              className="flex h-9 items-center gap-1 rounded-[10px] border border-dashed border-blue/40 px-2.5 text-sm font-medium text-blue hover:bg-blue/[0.04]"
            >
              <Icon icon={huge(Add01Icon)} size={14} stroke={1.4} />
              New project
            </button>
          )}
        </div>
      )}
      <div className="flex flex-col justify-center gap-2.5 rounded-[14px] border border-[#EDEDF0] bg-[#FAFAFA] p-4 focus-within:border-blue">
        <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label="Upload PDFs to this project"
          title={projectId ? "Upload PDFs to this project" : "Choose a project first"}
          disabled={!projectId}
          onClick={() => fileRef.current?.click()}
          className="shrink-0 text-body hover:text-[#101D37] disabled:opacity-40"
        >
          <Icon icon={huge(Add01Icon)} size={16} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => { void upload(Array.from(e.target.files ?? [])); e.target.value = ""; }}
        />
        <textarea
          rows={1}
          value={withLive(text, rec)}
          readOnly={rec.active}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            /* Enter sends, Shift+Enter adds a new line */
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={placeholder}
          aria-label="Your question"
          maxLength={4000}
          className="block w-full min-w-0 resize-none overflow-y-auto bg-transparent text-base leading-[1.5] tracking-[-0.02em] text-[#101D37] outline-none placeholder:text-body [field-sizing:content] max-h-[200px]"
        />
        </div>
        {rec.active && <RecordingBar rec={rec} caption={false} />}
        <VoiceError rec={rec} />
      </div>

      {uploads.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Uploads">
          {uploads.map((u) => (
            <li
              key={u.key}
              title={u.error}
              className={`flex h-7 max-w-full items-center gap-1.5 rounded-lg border px-2 text-[11px] ${
                u.state === "failed" ? "border-[#FDA29B] bg-[#FEF3F2] text-[#B42318]" : "border-[#EDEDF0] bg-[#FAFAFA] text-[#242C2C]"
              }`}
            >
              <span className="max-w-[220px] truncate">{u.name}</span>
              <span className="shrink-0 text-body">
                {u.state === "uploading" ? "uploading…" : u.state === "added" ? "added" : `failed: ${u.error}`}
              </span>
              {u.state !== "uploading" && (
                <button type="button" aria-label={`Hide ${u.name}`} onClick={() => setUploads((all) => all.filter((x) => x.key !== u.key))}>
                  <Icon icon={huge(Cancel01Icon)} size={12} stroke={1.4} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SourcesPicker scope={scope} onScopeChange={onScopeChange} />
          <ModelsPicker />
          <ReasoningPicker />
        </div>
        <div className="flex items-center gap-2.5">
          {!rec.active && !rec.transcribing && <MicButton rec={rec} size={36} />}
          <button
            type="submit"
            aria-label="Send"
            disabled={!canAsk}
            title={!projectId ? "Choose a project first" : uploading ? "Wait for the upload to finish" : undefined}
            className="flex size-9 items-center justify-center rounded-[10px] bg-blue text-white disabled:opacity-40"
          >
            <Icon icon={untitled(Send03)} size={16} />
          </button>
        </div>
      </div>
    </form>
  );
}
