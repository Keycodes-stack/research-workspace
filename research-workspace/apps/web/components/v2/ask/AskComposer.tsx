"use client";

import { useRef, useState } from "react";
import { Database01, Folder, Send03 } from "@untitledui/icons";
import { Add01Icon, Cancel01Icon, Mic01Icon } from "@hugeicons/core-free-icons";
import Icon, { huge, untitled } from "@/components/v2/dashboard/Icon";
import Picker, { type PickerOption } from "./Picker";
import { api } from "@/lib/api";
import type { EvidenceScope } from "@/lib/types";
import { SCOPES } from "@/lib/v2/ask";

type Upload = { key: string; name: string; state: "uploading" | "added" | "failed"; error?: string };

/**
 * Design: the Home "prompt card" (radius 20, padding 20, blue shadow): an input with "+", then Evidence Sources on the
 * left and mic + send on the right. "+" uploads PDFs to the project at once (they are chunked and embedded on upload,
 * so every later question can use them). The mic has no backend yet (placeholder.md).
 */
export default function AskComposer({
  projectId, projects, onProjectChange, scope, onScopeChange, busy, onAsk,
  placeholder = "Describe a question, research objective or decision to make..",
}: {
  projectId: string | null;
  /** when given, a project picker is shown (Home); the chat page passes none */
  projects?: PickerOption<string>[];
  onProjectChange?: (id: string) => void;
  scope: EvidenceScope;
  onScopeChange: (s: EvidenceScope) => void;
  busy: boolean;
  onAsk: (question: string) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploading = uploads.some((u) => u.state === "uploading");
  const question = text.trim();
  const canAsk = !!projectId && question.length >= 3 && !busy && !uploading;

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
      <div className="flex items-center gap-2 rounded-[14px] border border-[#EDEDF0] bg-[#FAFAFA] p-4">
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
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          aria-label="Your question"
          maxLength={4000}
          className="w-full min-w-0 bg-transparent text-base leading-[1.5] tracking-[-0.02em] text-[#101D37] outline-none placeholder:text-body"
        />
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
          {projects && onProjectChange && (
            <Picker
              icon={untitled(Folder)}
              label="Project"
              value={projectId}
              options={projects}
              onChange={onProjectChange}
              emptyText="No project can take questions yet. Create an open-discovery project first."
            />
          )}
          <Picker
            icon={untitled(Database01)}
            label="Evidence Sources"
            value={scope}
            options={SCOPES}
            onChange={onScopeChange}
          />
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            aria-label="Voice input (coming soon)"
            title="Voice input is coming soon"
            aria-disabled="true"
            className="flex size-9 items-center justify-center rounded-[10px] border border-[#EDEDF0] text-body"
          >
            <Icon icon={huge(Mic01Icon)} size={16} />
          </button>
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
