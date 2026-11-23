"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useProjects } from "@/components/v2/V2Frame";
import TopBar from "@/components/v2/dashboard/TopBar";
import ProjectsPanel from "@/components/v2/dashboard/ProjectsPanel";
import AssessmentCard from "@/components/v2/projects/AssessmentCard";
import DictateButton from "@/components/v2/projects/DictateButton";
import RemoveButton from "@/components/v2/ui/RemoveButton";
import { api, ApiError } from "@/lib/api";
import type { Person } from "@/lib/types";
import {
  EMPTY_PROJECT_DRAFT,
  FIELD_LIMITS,
  SPEC_OPTIONS,
  LIST_LIMITS,
  PROJECT_SECTIONS,
  ROW_LIMITS,
  charterOverLimits,
  type IntakeResponse,
  type ProjectDraft,
  type ProjectInsights,
  type ProjectQuestion,
} from "@/lib/projectIntake";
import { clearProjectDraft, readProjectDraft, writeProjectDraft } from "@/lib/projectDraftStore";
import { V2, projectHref } from "@/lib/v2/routes";

type ChatMessage = { from: "ai" | "user"; text: string };
const DEPARTMENTS = SPEC_OPTIONS.departments;
const REG_CONTROLS = ["Independent acceptance", "Evidence traceability", "Record decisions and changes"];
const inputClass = "w-full rounded-[10px] border border-[#EDEDF0] bg-white px-3 py-2.5 text-sm text-[#101D37] outline-none transition focus:border-blue focus:ring-2 focus:ring-blue/10";
const labelClass = "mb-1.5 block text-sm font-medium text-[#344054]";

/** Fields each wizard step owns; "Suggest with AI" fills only the empty ones among them. */
const STEP_FIELDS: Record<number, (keyof ProjectDraft)[]> = {
  0: ["name", "type", "objective", "background", "priority", "programme", "business_unit", "start", "target",
      "in_scope", "out_scope", "deliverable", "measures", "assumptions", "dependencies"],
  1: ["departments", "stakeholders", "decision_notes", "external_orgs"],
  2: ["approach", "reporting", "budget", "currency", "resources", "workstreams", "gates", "risks", "no_risk_reason"],
  3: ["governance", "classification", "data_location", "retention", "standards", "quality_lead", "reg_controls",
      "visibility", "approvals", "change_authority", "gate_rule", "plan_editing", "manage_access", "external_partner_ingestion"],
  4: [],
};
const isEmptyValue = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
/** Only text and lists of text can be suggested and pasted into a field; object lists (workstreams, gates, risks) are added by hand. */
const isTextSuggestion = (v: unknown) => typeof v === "string" || (Array.isArray(v) && v.every((x) => typeof x === "string"));
const asText = (v: unknown) => (Array.isArray(v) ? v.join(", ") : String(v ?? ""));
const labelOf = (key: string) => key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Red asterisk after the label of a field the project cannot be created without. */
const RequiredMark = () => <span aria-hidden="true" className="ml-0.5 text-[#B42318]">*</span>;
/** Fields that are always required (conditional ones are decided where they are shown). */
const REQUIRED_FIELDS = new Set<keyof ProjectDraft>(["name", "type", "objective", "lead", "departments"]);

function Field({ label, suggested, required, children }: { label: string; suggested?: boolean; required?: boolean; children: ReactNode }) {
  return <div className="block"><span className={labelClass}>{label}{required && <RequiredMark />}{suggested && <span className="ml-2 rounded-md bg-blue/[0.08] px-1.5 py-0.5 text-[11px] font-semibold text-blue">AI Suggested · review</span>}</span>{children}</div>;
}

function textValue(v: unknown) { return typeof v === "string" ? v : ""; }
function nameFrom(prompt: string) {
  const cleaned = prompt.trim().replace(/[.?!][\s\S]*$/, "").replace(/^(please\s+)?(investigate|assess|evaluate|explore|study|analy[sz]e|research|determine|review)\s+/i, "");
  return cleaned.split(/,|;|\s+(?:for|in|at|across|within)\s+/i)[0].trim().split(/\s+/).slice(0, 7).map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ");
}

function Stepper({ active, onSelect, completed }: { active: number; onSelect: (i: number) => void; completed: number[] }) {
  return <ol aria-label="Project setup progress" className="grid grid-cols-5 gap-1 sm:gap-3">
    {PROJECT_SECTIONS.map((name, i) => {
      const done = completed.includes(i);
      return <li key={name} className="relative text-center">
        {i < PROJECT_SECTIONS.length - 1 && <span className={`absolute left-[62%] top-5 hidden h-1 w-[76%] rounded-full sm:block ${done ? "bg-blue" : "bg-[#EDEDF0]"}`} />}
        <button type="button" onClick={() => onSelect(i)} aria-current={active === i ? "step" : undefined}
          className={`relative z-10 mx-auto flex size-10 items-center justify-center rounded-full text-sm font-semibold ${active === i || done ? "bg-blue text-white" : "border-2 border-[#EDEDF0] bg-white text-[#667085]"}`}>
          {done && active !== i ? "✓" : i + 1}
        </button>
        <span className={`mt-1 block text-[11px] sm:text-sm ${active === i ? "font-semibold text-[#101D37]" : "text-[#667085]"}`}>{name}</span>
      </li>;
    })}
  </ol>;
}

/** One question at a time: answer, then Next; the last question sends all answers together. */
function QuestionCard({ questions, onAnswer, onSkip, busy }: {
  questions: ProjectQuestion[]; onAnswer: (answers: string) => void; onSkip: () => void; busy: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const q = questions[index];
  const last = index === questions.length - 1;
  const answerFor = (i: number) => [...(selected[i] ?? []), other[i]?.trim()].filter(Boolean).join(", ");
  const answered = questions.filter((_, i) => answerFor(i)).length;
  const allAnswered = answered === questions.length;
  const toggle = (i: number, value: string, multi: boolean) => setSelected((old) => {
    const current = old[i] ?? [];
    return { ...old, [i]: multi ? (current.includes(value) ? current.filter((v) => v !== value) : [...current, value]) : [value] };
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!allAnswered) return;
    onAnswer(questions.map((item, i) => `Q: ${item.question}\nA: ${answerFor(i)}`).join("\n\n"));
  };
  const checkedOf = (label: string) => (selected[index] ?? []).includes(label);
  return <form onSubmit={submit} className="flex flex-col gap-4 rounded-[16px] border border-[#EDEDF0] bg-white p-4">
    <div className="flex flex-wrap items-center gap-2">
      {questions.map((item, i) => <button key={`${item.header}-${i}`} type="button" onClick={() => setIndex(i)} aria-current={i === index ? "step" : undefined}
        className={`flex items-center gap-1.5 rounded-[10px] border px-3 py-1.5 text-xs font-medium ${i === index ? "border-blue bg-blue text-white" : "border-[#EDEDF0] bg-white text-[#344054]"}`}>
        <span>{i + 1}</span>{item.header}
      </button>)}
      <span className="text-xs text-[#667085]">{answered}/{questions.length} answered</span>
    </div>
    <fieldset key={`${q.header}-${index}`} className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-semibold text-[#101D37]">{q.question}{q.multi_select && <span className="ml-2 text-xs font-normal text-[#667085]">Choose all that apply</span>}</legend>
      {q.options.map((o, oi) => {
        const checked = checkedOf(o.label);
        return <button key={o.label} type="button" onClick={() => toggle(index, o.label, q.multi_select)}
          role={q.multi_select ? "checkbox" : "radio"} aria-checked={checked}
          className={`flex items-start gap-3 rounded-[10px] border p-3 text-left text-sm ${checked ? "border-blue bg-blue/[0.04]" : "border-[#EDEDF0] bg-white"}`}>
          <span className={`mt-0.5 flex size-4 shrink-0 items-center justify-center border ${q.multi_select ? "rounded-[4px]" : "rounded-full"} ${checked ? "border-blue bg-blue text-[10px] text-white" : "border-[#D0D5DD]"}`}>{checked ? "✓" : ""}</span>
          <span><span className="font-medium text-[#101D37]">{oi + 1}. {o.label}</span>{o.description && <span className="mt-0.5 block text-xs text-[#667085]">{o.description}</span>}</span>
        </button>;
      })}
      <label className="flex items-center gap-3 rounded-[10px] border border-[#EDEDF0] bg-white p-3 text-sm">
        <span className="font-medium text-[#344054]">Other</span>
        <input className="w-full bg-transparent text-sm text-[#101D37] outline-none placeholder:text-[#98A2B3]" placeholder="Type your own answer..." maxLength={500} value={other[index] ?? ""} onChange={(e) => setOther((x) => ({ ...x, [index]: e.target.value }))} />
      </label>
    </fieldset>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <button type="button" onClick={onSkip} disabled={busy} className="text-sm font-medium text-[#667085]">Skip, draft the rest for me</button>
      <div className="flex gap-2">
        {index > 0 && <button type="button" onClick={() => setIndex(index - 1)} disabled={busy} className="rounded-[10px] border border-[#EDEDF0] bg-white px-4 py-2 text-sm font-medium text-[#344054]">Back</button>}
        {!last && <button type="button" onClick={() => setIndex(index + 1)} disabled={busy} className="rounded-[10px] border border-[#EDEDF0] bg-white px-4 py-2 text-sm font-medium text-[#344054]">Next →</button>}
        <button type="submit" disabled={busy || !allAnswered} className="rounded-[10px] bg-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Thinking…" : "Submit answers"}</button>
      </div>
    </div>
  </form>;
}

export default function NewProjectFlow() {
  const { reload } = useProjects();
  const [phase, setPhase] = useState<"prompt" | "chat" | "setup" | "created">("prompt");
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<ProjectDraft>(EMPTY_PROJECT_DRAFT);
  const [section, setSection] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [questions, setQuestions] = useState<ProjectQuestion[]>([]);
  const [round, setRound] = useState(0);
  const [asked, setAsked] = useState<string[]>([]);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [createdId, setCreatedId] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [insights, setInsights] = useState<ProjectInsights | null>(null);
  const [insightsMissing, setInsightsMissing] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [draftNote, setDraftNote] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  useEffect(() => {
    let live = true;
    api.people().then((rows) => { if (live) setPeople(rows); }).catch(() => { if (live) setPeopleError("The people directory could not be loaded. Try again."); });
    return () => { live = false; };
  }, []);
  const router = useRouter();
  const [draftId, setDraftId] = useState("");
  const [suggestions, setSuggestions] = useState<Record<string, string>>({});
  const [pdfs, setPdfs] = useState<File[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [peopleError, setPeopleError] = useState("");
  const [addingPerson, setAddingPerson] = useState<"sponsor_id" | "lead_id" | null>(null);
  const [newPerson, setNewPerson] = useState({ full_name: "", department: "", job_title: "", email: "" });
  const [personError, setPersonError] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [uploadNote, setUploadNote] = useState("");
  const [savingDraft, setSavingDraft] = useState(false);

  // Resume an unfinished project after a refresh; autosave every change until it is created.
  useEffect(() => {
    const saved = readProjectDraft();
    if (saved) {
      setPhase(saved.phase);
      setPrompt(saved.prompt);
      setFiles(saved.files ?? []);
      setDraft({ ...EMPTY_PROJECT_DRAFT, ...(saved.draft as Partial<ProjectDraft>) });
      setSection(Math.min(Math.max(saved.section, 0), PROJECT_SECTIONS.length - 1));
      setMessages(saved.messages);
      setQuestions(saved.questions as ProjectQuestion[]);
      setAsked(saved.asked);
      setSuggested(saved.suggested);
      setRound(saved.round);
      setDraftId(saved.draftId ?? "");
    }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated || phase === "created") return;
    if (phase === "prompt" && !prompt.trim() && files.length === 0) { clearProjectDraft(); return; }
    writeProjectDraft({ v: 1, draftId, phase, prompt, files, draft, section, messages, questions, asked, suggested, round });
  }, [hydrated, draftId, phase, prompt, files, draft, section, messages, questions, asked, suggested, round]);

  const startOver = () => {
    clearProjectDraft();
    setDraftId(""); setSuggestions({}); setPdfs([]); setImages([]); setUploadNote("");
    setPhase("prompt"); setPrompt(""); setFiles([]); setDraft(EMPTY_PROJECT_DRAFT); setSection(0);
    setMessages([]); setQuestions([]); setRound(0); setAsked([]); setSuggested([]); setError(""); setSaveError("");
  };

  const runIntake = async (mode: "start" | "answer" | "finish" | "edit", text: string, history: ChatMessage[], current: ProjectDraft, currentRound: number) => {
    setBusy(true); setError("");
    try {
      const response: IntakeResponse = await api.projectIntake({ mode, text, draft: current, asked, history: history.slice(-10), round: currentRound });
      setDraft((old) => ({ ...old, ...response.patch }));
      setSuggested((old) => [...new Set([...old, ...Object.keys(response.patch)])]);
      if (response.reply) setMessages((old) => [...old, { from: "ai", text: response.reply }]);
      setQuestions(response.questions);
      setRound((n) => n + 1);
      if (response.done && mode !== "edit") setError("");
      return response;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Project suggestions could not be loaded.";
      setError(message);
      return null;
    } finally { setBusy(false); }
  };

  const begin = async (e: FormEvent) => {
    e.preventDefault();
    const text = prompt.trim(); if (!text) return;
    const full = files.length ? `${text}\n\nAttached files (names only): ${files.join(", ")}` : text;
    const initial: ProjectDraft = { ...EMPTY_PROJECT_DRAFT, name: nameFrom(text), objective: text };
    const first = { from: "user" as const, text: full };
    setDraft(initial); setMessages([first]); setPhase("chat"); setRound(0); setAsked([]); setSuggested([]); setQuestions([]);
    await runIntake("start", full, [first], initial, 0);
  };

  const answerQuestions = (text: string) => {
    const user = { from: "user" as const, text };
    const next = [...messages, user]; setMessages(next); setAsked(questions.map((q) => q.question)); setQuestions([]);
    void runIntake("answer", text, next, draft, round);
  };
  const skipQuestions = () => {
    const text = "Skip the questions and draft the rest for me to review.";
    const next = [...messages, { from: "user" as const, text }]; setMessages(next); setQuestions([]);
    void runIntake("finish", text, next, draft, round);
  };
  const update = <K extends keyof ProjectDraft>(key: K, value: ProjectDraft[K]) => {
    setDraft((old) => ({ ...old, [key]: value }));
    setSuggested((old) => old.filter((k) => k !== key));
  };
  const editWithAi = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const form = new FormData(e.currentTarget); const text = String(form.get("change") ?? "").trim(); if (!text) return;
    const next = [...messages, { from: "user" as const, text }]; setMessages(next); e.currentTarget.reset();
    setBusy(true); setError("");
    try {
      const response = await api.projectIntake({ mode: "edit", text, draft, asked: [], history: next.slice(-10), round });
      const patch = response.patch as Record<string, unknown>;
      const proposed = Object.keys(patch).filter((k) => isTextSuggestion(patch[k]));
      setSuggestions((old) => ({ ...old, ...Object.fromEntries(proposed.map((k) => [k, asText(patch[k])])) }));
      if (response.reply) setMessages((old) => [...old, { from: "ai", text: response.reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The assistant could not answer right now.");
    } finally { setBusy(false); }
  };

  /** Asks the AI for the empty fields of the current step only. Values the user typed are never replaced. */
  const suggestStep = async () => {
    const keys = STEP_FIELDS[section].filter((k) => isEmptyValue(draft[k]));
    if (keys.length === 0) { setSaveError("Every field in this step already has a value."); return; }
    setSuggesting(true); setSaveError("");
    try {
      const response = await api.projectIntake({
        mode: "edit",
        text: `Suggest values only for these empty fields: ${keys.join(", ")}. Leave every other field unchanged.`,
        draft, asked: [], history: messages.slice(-10), round,
      });
      const filled = keys.filter((k) => !isEmptyValue(response.patch[k]) && isTextSuggestion(response.patch[k]));
      if (filled.length === 0) { setSaveError("The AI had no suggestion for these fields. Fill them in yourself."); return; }
      setSuggestions((old) => ({ ...old, ...Object.fromEntries(filled.map((k) => [k, asText(response.patch[k])])) }));
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "AI suggestions are unavailable right now.");
    } finally { setSuggesting(false); }
  };

  const saveDraft = async () => {
    setSavingDraft(true); setSaveError("");
    try {
      const saved = await api.saveProjectDraft({ draft_id: draftId || undefined, name: draft.name, mode: draft.mode, charter: draft });
      setDraftId(saved.id); setDraftNote(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "The draft could not be saved.");
    } finally { setSavingDraft(false); }
  };
  const deleteDraft = async () => {
    if (draftId) {
      try { await api.deleteProject(draftId); }
      catch (e) { if (!(e instanceof ApiError && e.status === 404)) { setSaveError(e instanceof Error ? e.message : "The draft could not be deleted."); return; } }
    }
    startOver();
  };
  const dropSuggestion = (key: string) => setSuggestions((old) => { const next = { ...old }; delete next[key]; return next; });
  const useSuggestion = (key: string) => {
    const text = suggestions[key] ?? "";
    const current = draft[key as keyof ProjectDraft];
    update(key as keyof ProjectDraft, (Array.isArray(current) ? text.split(",").map((x) => x.trim()).filter(Boolean) : text) as never);
    dropSuggestion(key);
  };
  const useAllSuggestions = () => { for (const key of Object.keys(suggestions)) useSuggestion(key); };
  const addFiles = (e: React.ChangeEvent<HTMLInputElement>, kind: "image" | "pdf") => {
    const picked = Array.from(e.target.files ?? []);
    setFiles((old) => [...new Set([...old, ...picked.map((f) => f.name)])].slice(0, 10));
    if (kind === "pdf") setPdfs((old) => [...old, ...picked.filter((f) => f.name.toLowerCase().endsWith(".pdf"))].slice(0, 10));
    else setImages((old) => [...old, ...picked.filter((f) => f.type.startsWith("image/"))].slice(0, 10));
    e.target.value = "";
  };

  const missing: string[] = [];
  for (const problem of charterOverLimits(draft)) missing.push(`Shorten ${problem}.`);
  if (!draft.type) missing.push("Choose a project type.");
  if (!draft.name.trim()) missing.push("Add a project name.");
  if (!draft.objective.trim()) missing.push("Describe the business objective.");
  if (draft.start && draft.target && draft.target < draft.start) missing.push("Target completion must be after the planned start.");
  if (!draft.departments.length) missing.push("Select at least one participating department.");
  if (draft.team_mode === "Assign participating teams now" && !draft.teams.length) missing.push("Choose a team or set department leads to assign teams later.");
  if (!draft.lead.trim()) missing.push("Name an accountable project lead.");
  if (!draft.workstreams.some((w) => w.name.trim() && w.owner.trim() && w.output.trim())) missing.push("Add a workstream with an owner and expected output.");
  if (!draft.gates.some((g) => g.name.trim() && g.criteria.trim())) missing.push("Add a decision gate with acceptance criteria.");
  if (draft.gates.some((g) => !g.approver.trim())) missing.push("Assign an approver to every decision gate.");
  if (draft.gates.some((g) => !g.workstreams.length)) missing.push("Link each decision gate to at least one workstream.");
  if (!draft.risks.some((r) => r.risk.trim()) && !draft.no_risk_reason.trim()) missing.push("Add a risk or explain why there are none.");
  const ready = missing.length === 0;
  const create = async () => {
    setBusy(true); setSaveError(""); setInsightsMissing(false);
    // The assessment is part of the project record; if it fails, the project is still created without it.
    let assessment: ProjectInsights | null = null;
    try { assessment = await api.projectInsights(draft); } catch { setInsightsMissing(true); }
    const meta = {
      type: draft.type, objective: draft.objective, priority: draft.priority, lead: draft.lead, sponsor: draft.sponsor,
      governance: draft.governance, start: draft.start, target: draft.target, background: draft.background,
      in_scope: draft.in_scope, out_scope: draft.out_scope, deliverable: draft.deliverable, measures: draft.measures,
      departments: draft.departments.join(", "), visibility: draft.visibility, classification: draft.classification,
      approvals: draft.approvals, standards: draft.standards,
    };
    const work_packages = draft.workstreams.filter((w) => w.name.trim()).map((w) => ({
      title: w.name,
      lead: w.owner,
      due: w.due,
      brief: JSON.stringify({ objective: draft.objective, workstream: w, approach: draft.approach, reporting: draft.reporting, dependencies: draft.dependencies }),
    }));
    try {
      const project = await api.createProjectComplete({ name: draft.name, mode: draft.mode, meta, charter: draft, work_packages, insights: assessment ?? undefined }, draftId || undefined);
      let failed = 0;
      for (const file of pdfs) { try { await api.upload(project.id, file); } catch { failed += 1; } }
      for (const file of images) { try { await api.uploadProjectAttachment(project.id, file); } catch { failed += 1; } }
      const added = pdfs.length + images.length;
      setUploadNote(failed ? `${failed} file(s) could not be added to the project.` : added ? `${added} file(s) added to the project.` : "");
      setInsights(assessment); setCreatedId(project.id); clearProjectDraft(); setPhase("created"); await reload();
      setTimeout(() => router.push(projectHref(project)), 1500);
    } catch (e) { setSaveError(e instanceof Error ? e.message : "Could not create project."); }
    finally { setBusy(false); }
  };

  const isRequired = (key: keyof ProjectDraft) =>
    REQUIRED_FIELDS.has(key)
    || (key === "teams" && draft.team_mode === "Assign participating teams now")
    || (key === "no_risk_reason" && !draft.risks.some((r) => r.risk.trim()));
  const field = (key: keyof ProjectDraft, title: string, multiline = false, type = "text") => {
    const value = key === "teams" ? draft.teams.join("\n") : textValue(draft[key]);
    const change = (next: string) => update(key, (key === "teams" ? next.split("\n").map((x) => x.trim()).filter(Boolean) : next) as never);
    const maxLength = key === "teams" ? (LIST_LIMITS.teams.item + 1) * LIST_LIMITS.teams.max : FIELD_LIMITS[key];
    return <Field key={key} label={title} suggested={suggested.includes(key)} required={isRequired(key)}>
      {multiline ? <textarea aria-label={title} maxLength={maxLength} className={`${inputClass} min-h-24 resize-y`} value={value} onChange={(e) => change(e.target.value)} />
        : <input aria-label={title} type={type} maxLength={maxLength} className={inputClass} value={value} onChange={(e) => change(e.target.value)} />}
    </Field>;
  };

  /** Charter row: label on the left, value box on the right, "AI Suggested" tag while the AI owns the value. */
  const row = (key: keyof ProjectDraft, title: string, multiline = false, type = "text") => {
    const value = textValue(draft[key]);
    const tag = suggested.includes(key);
    const limit = FIELD_LIMITS[key];
    return <div key={key} className="grid gap-2 border-t border-[#EDEDF0] py-4 md:grid-cols-[200px_1fr] md:items-start">
      <span className="pt-2.5 text-sm font-semibold text-[#101D37]">{title}{isRequired(key) && <RequiredMark />}</span>
      <div className="relative">
        {multiline ? <textarea aria-label={title} maxLength={limit} className={`${inputClass} min-h-24 resize-y ${tag ? "pr-28" : ""}`} value={value} onChange={(e) => update(key, e.target.value as never)} />
          : <input aria-label={title} type={type} maxLength={limit} className={`${inputClass} ${tag ? "pr-28" : ""}`} value={value} onChange={(e) => update(key, e.target.value as never)} />}
        {tag && <span className="absolute right-3 top-2.5 rounded-md bg-blue/[0.08] px-1.5 py-0.5 text-[11px] font-semibold text-blue">AI Suggested</span>}
        {multiline && limit && <span className="mt-1 block text-right text-[11px] text-[#98A2B3]">{value.length}/{limit}</span>}
      </div>
    </div>;
  };

  /** Charter row with a dropdown (spec 3.3): label on the left, "AI Suggested" tag while the AI owns the value. */
  const choiceRow = (key: keyof ProjectDraft, title: string, options: readonly string[]) => <div key={key} className="grid gap-2 border-t border-[#EDEDF0] py-4 md:grid-cols-[200px_1fr] md:items-start">
    <span className="pt-2.5 text-sm font-semibold text-[#101D37]">{title}{isRequired(key) && <RequiredMark />}</span>
    <div className="relative"><select aria-label={title} className={`${inputClass} ${suggested.includes(key) ? "pr-28" : ""}`} value={textValue(draft[key])} onChange={(e) => update(key, e.target.value as never)}>
      <option value="">Select…</option>{options.map((x) => <option key={x}>{x}</option>)}</select>
      {suggested.includes(key) && <span className="absolute right-3 top-2.5 rounded-md bg-blue/[0.08] px-1.5 py-0.5 text-[11px] font-semibold text-blue">AI Suggested</span>}</div>
  </div>;
  /** Dropdown in the grid layout of steps 3-4. */
  const selectField = (key: keyof ProjectDraft, title: string, options: readonly string[]) => <Field label={title} suggested={suggested.includes(key)} required={isRequired(key)}>
    <select aria-label={title} className={inputClass} value={textValue(draft[key])} onChange={(e) => update(key, e.target.value as never)}>
      <option value="">Select…</option>{options.map((x) => <option key={x}>{x}</option>)}</select>
  </Field>;

  /** Sponsor or lead chosen from the people directory; the name is kept alongside the id for display and export. */
  const choosePerson = (idKey: "sponsor_id" | "lead_id", nameKey: "sponsor" | "lead", id: string) => {
    update(idKey, id);
    update(nameKey, people.find((p) => p.id === id)?.full_name ?? "");
  };
  const saveNewPerson = async () => {
    setPersonError("");
    try {
      const created = await api.createPerson({
        full_name: newPerson.full_name, department: newPerson.department || null,
        job_title: newPerson.job_title || null, email: newPerson.email || null,
      });
      const person: Person = { id: created.id, full_name: created.full_name, email: newPerson.email || null,
        department: newPerson.department || null, job_title: newPerson.job_title || null, active: true };
      setPeople((old) => [...old, person].sort((a, b) => a.full_name.localeCompare(b.full_name)));
      if (addingPerson) choosePerson(addingPerson, addingPerson === "sponsor_id" ? "sponsor" : "lead", person.id);
      setAddingPerson(null);
      setNewPerson({ full_name: "", department: "", job_title: "", email: "" });
    } catch (e) {
      setPersonError(e instanceof Error ? e.message : "The person could not be added.");
    }
  };
  const personPicker = (idKey: "sponsor_id" | "lead_id", nameKey: "sponsor" | "lead", label: string) => <Field label={label} required={idKey === "lead_id"}>
    <select aria-label={label} className={inputClass} value={draft[idKey]}
      onChange={(e) => (e.target.value === "__new__" ? setAddingPerson(idKey) : choosePerson(idKey, nameKey, e.target.value))}>
      <option value="">Select a person…</option>
      {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}{p.department ? ` · ${p.department}` : ""}</option>)}
      <option value="__new__">+ Add a person…</option>
    </select>
    {addingPerson === idKey && <div className="mt-2 grid gap-2 rounded-[12px] border border-[#EDEDF0] p-3">
      <input aria-label="New person name" placeholder="Full name" value={newPerson.full_name} maxLength={120} onChange={(e) => setNewPerson((x) => ({ ...x, full_name: e.target.value }))} className={inputClass} />
      <input aria-label="New person department" placeholder="Department" value={newPerson.department} maxLength={120} onChange={(e) => setNewPerson((x) => ({ ...x, department: e.target.value }))} className={inputClass} />
      <input aria-label="New person job title" placeholder="Job title" value={newPerson.job_title} maxLength={120} onChange={(e) => setNewPerson((x) => ({ ...x, job_title: e.target.value }))} className={inputClass} />
      <input aria-label="New person email" placeholder="Email (optional)" type="email" value={newPerson.email} maxLength={254} onChange={(e) => setNewPerson((x) => ({ ...x, email: e.target.value }))} className={inputClass} />
      {personError && <p role="alert" className="text-xs text-[#B42318]">{personError}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setAddingPerson(null)} className="text-xs font-semibold text-[#667085]">Cancel</button>
        <button type="button" onClick={() => void saveNewPerson()} disabled={!newPerson.full_name.trim()} className="rounded-[8px] bg-blue px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Save person</button>
      </div>
    </div>}
  </Field>;

  const content = () => {
    if (section === 0) return <div className="rounded-[16px] border border-[#EDEDF0] bg-white p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-[#101D37]">Project Charter</h3><span className="text-xs text-[#667085]">Review every suggestion before you continue</span></div>
      {row("name", "Project name")}
      {choiceRow("type", "Project type", SPEC_OPTIONS.type)}
      {choiceRow("priority", "Priority", SPEC_OPTIONS.priority)}
      {row("programme", "Programme / portfolio")}
      {row("business_unit", "Business unit")}
      {row("objective", "Business objective", true)}
      {row("background", "Background and context", true)}
      {row("start", "Planned start", false, "date")}
      {row("target", "Target completion", false, "date")}
      {row("in_scope", "In scope", true)}
      {row("out_scope", "Out of scope", true)}
      {row("deliverable", "Key deliverable", true)}
      {row("measures", "Success measures", true)}
      {row("assumptions", "Assumptions", true)}
      {row("dependencies", "Dependencies", true)}
    </div>;
    if (section === 1) return <div className="grid gap-4 md:grid-cols-2">
      {personPicker("sponsor_id", "sponsor", "Project sponsor")}{personPicker("lead_id", "lead", "Accountable project lead")}
      <Field label="Core team members">{peopleError ? <p role="alert" className="text-xs text-[#B42318]">{peopleError}</p> : <div className="grid gap-2 sm:grid-cols-2">{people.map((p) => <label key={p.id} className="flex items-center gap-2 text-sm text-[#344054]"><input type="checkbox" checked={draft.core_team_ids.includes(p.id)} onChange={(e) => update("core_team_ids", e.target.checked ? [...draft.core_team_ids, p.id] : draft.core_team_ids.filter((x) => x !== p.id))} />{p.full_name}</label>)}{people.length === 0 && <p className="text-xs text-[#667085]">No people yet. Add them from Organization &amp; Access or from the sponsor and lead fields.</p>}</div>}</Field>
      <Field label="Participating departments" suggested={suggested.includes("departments")} required><div className="grid gap-2 sm:grid-cols-2">{DEPARTMENTS.map((d) => <label key={d} className="flex items-center gap-2 text-sm text-[#344054]"><input type="checkbox" checked={draft.departments.includes(d)} onChange={(e) => update("departments", e.target.checked ? [...draft.departments, d] : draft.departments.filter((x) => x !== d))} />{d}</label>)}</div></Field>
      <div className="flex flex-col gap-4"><Field label="Team assignment" required><select aria-label="Team assignment" className={inputClass} value={draft.team_mode} onChange={(e) => update("team_mode", e.target.value)}><option>Assign participating teams now</option><option>Department leads assign their teams later</option></select></Field>{field("teams", "Participating teams (one per line)", true)}{field("stakeholders", "Key stakeholders", true)}{field("decision_notes", "Stakeholder and decision notes", true)}{field("external_orgs", "External organizations", true)}</div>
    </div>;
    if (section === 2) return <div className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-2"><Field label="Research mode" suggested><p aria-label="Research mode" className={`${inputClass} bg-[#FAFAFA] text-[#475467]`}>{draft.mode === "closed_repository" ? "Closed repository · uses approved sources only" : "Open discovery · searches scholarly sources"}</p></Field>{selectField("approach", "Delivery approach", SPEC_OPTIONS.approach)}{selectField("reporting", "Reporting frequency", SPEC_OPTIONS.reporting)}{field("budget", "Indicative budget", false, "number")}{selectField("currency", "Currency", SPEC_OPTIONS.currency)}{field("resources", "Resource assumptions", true)}</div>
      <div className="rounded-[14px] border border-[#EDEDF0] p-4"><div className="mb-3 flex items-center justify-between"><div><h3 className="font-semibold text-[#101D37]">Workstreams</h3><p className="text-xs text-[#667085]">Each workstream becomes a draft research package.</p></div><button type="button" onClick={() => update("workstreams", [...draft.workstreams, { name: "", department: "", team: "", output: "", owner: "", reviewer: "", start: "", due: "", dependencies: "" }])} className="rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm font-medium">+ Add workstream</button></div>
        {draft.workstreams.map((w, i) => <div key={i} className="mb-4 grid gap-3 border-t border-[#EDEDF0] pt-4 md:grid-cols-2">{(["name", "department", "team", "output", "owner", "reviewer", "start", "due", "dependencies"] as const).map((k) => { const label = k === "name" ? `Workstream ${i + 1}` : `Workstream ${i + 1} ${k === "start" ? "start date" : k === "due" ? "due date" : k}`; return <Field key={k} label={label} suggested={suggested.includes("workstreams")} required={k === "name" || k === "owner" || k === "output"}><input aria-label={label} type={k === "start" || k === "due" ? "date" : "text"} maxLength={ROW_LIMITS.workstreams.fields[k]} className={inputClass} value={w[k]} onChange={(e) => update("workstreams", draft.workstreams.map((x, j) => j === i ? { ...x, [k]: e.target.value } : x))} /></Field>; })}<RemoveButton onClick={() => update("workstreams", draft.workstreams.filter((_, j) => j !== i))} /></div>)}
      </div>
      <div className="rounded-[14px] border border-[#EDEDF0] p-4"><div className="mb-3 flex items-center justify-between"><div><h3 className="font-semibold text-[#101D37]">Decision gates</h3><p className="text-xs text-[#667085]">Add the checks needed before decisions.</p></div><button type="button" onClick={() => update("gates", [...draft.gates, { name: "", owner: "", approver: "", date: "", criteria: "", workstreams: [] }])} className="rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm font-medium">+ Add gate</button></div>{draft.gates.map((g, i) => <div key={i} className="mb-4 grid gap-3 border-t border-[#EDEDF0] pt-4 md:grid-cols-2">{(["name", "owner", "approver", "date", "criteria"] as const).map((k) => <Field key={k} label={`Gate ${i + 1} · ${k}`} suggested={suggested.includes("gates")} required={k === "name" || k === "criteria" || k === "approver"}><input aria-label={`Gate ${i + 1} ${k}`} type={k === "date" ? "date" : "text"} maxLength={ROW_LIMITS.gates.fields[k]} className={inputClass} value={g[k]} onChange={(e) => update("gates", draft.gates.map((x, j) => j === i ? { ...x, [k]: e.target.value } : x))} /></Field>)}<fieldset className="flex flex-col gap-2"><legend className="text-sm font-medium">Workstreams covered<RequiredMark /></legend>{draft.workstreams.map((w, wi) => <label key={wi} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={g.workstreams.includes(w.name)} onChange={(e) => update("gates", draft.gates.map((x, j) => j === i ? { ...x, workstreams: e.target.checked ? [...x.workstreams, w.name] : x.workstreams.filter((n) => n !== w.name) } : x))} />{w.name || `Workstream ${wi + 1}`}</label>)}</fieldset><RemoveButton onClick={() => update("gates", draft.gates.filter((_, j) => j !== i))} /></div>)}</div>
      <div className="rounded-[14px] border border-[#EDEDF0] p-4"><div className="mb-3 flex items-center justify-between"><div><h3 className="font-semibold text-[#101D37]">Risk register</h3><p className="text-xs text-[#667085]">Risks remain proposals until your team reviews them.</p></div><button type="button" onClick={() => update("risks", [...draft.risks, { risk: "", owner: "", severity: "Medium", response: "" }])} className="rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm font-medium">+ Add risk</button></div>{draft.risks.map((r, i) => <div key={i} className="mb-4 grid gap-3 border-t border-[#EDEDF0] pt-4 md:grid-cols-2">{(["risk", "owner", "severity", "response"] as const).map((k) => <Field key={k} label={`Risk ${i + 1} · ${k}`} suggested={suggested.includes("risks")}><input aria-label={`Risk ${i + 1} ${k}`} maxLength={ROW_LIMITS.risks.fields[k]} className={inputClass} value={r[k]} onChange={(e) => update("risks", draft.risks.map((x, j) => j === i ? { ...x, [k]: e.target.value } : x))} /></Field>)}<RemoveButton onClick={() => update("risks", draft.risks.filter((_, j) => j !== i))} /></div>)}{field("no_risk_reason", "If none, explain why this project has no significant risks", true)}</div>
    </div>;
    if (section === 3) return <div className="grid gap-4 md:grid-cols-2">
      {selectField("governance", "Governance level", SPEC_OPTIONS.governance)}{field("controls_mode", "Controls profile")}
      <Field label="Project visibility"><select aria-label="Project visibility" className={inputClass} value={draft.visibility} onChange={(e) => update("visibility", e.target.value)}>{["Project members only", "Organization summary"].map((x) => <option key={x}>{x}</option>)}</select></Field>
      {selectField("classification", "Information classification", SPEC_OPTIONS.classification)}
      {field("plan_editing", "Who can edit the plan")}{field("manage_access", "Who manages access")}{field("approvals", "Research approvals")}{field("change_authority", "Change authorization")}
      {field("standards", "Applicable standards and regulations", true)}{field("quality_lead", "Quality lead")}{field("gate_rule", "Gate approval rule")}
      <Field label="Quality and assurance checks" suggested={suggested.includes("reg_controls")}><div className="flex flex-col gap-2">{REG_CONTROLS.map((x) => <label key={x} className="flex items-center gap-2 text-sm text-[#344054]"><input type="checkbox" checked={draft.reg_controls.includes(x)} onChange={(e) => update("reg_controls", e.target.checked ? [...draft.reg_controls, x] : draft.reg_controls.filter((c) => c !== x))} />{x}</label>)}</div></Field>
      {selectField("data_location", "Data handling region", SPEC_OPTIONS.data_location)}{selectField("retention", "Retention requirement", SPEC_OPTIONS.retention)}
      <Field label="External partner evidence ingestion"><label className="flex items-center gap-3 rounded-[10px] border border-[#EDEDF0] bg-white px-3 py-2.5 text-sm text-[#344054]"><input type="checkbox" role="switch" checked={draft.external_partner_ingestion} onChange={(e) => update("external_partner_ingestion", e.target.checked)} />Allow external partners to submit evidence</label></Field>
    </div>;
    return <div className="flex flex-col gap-5">
      <div className="rounded-[14px] bg-[#F8FAFC] p-4"><h3 className="font-semibold text-[#101D37]">{draft.name || "Untitled project"}</h3><p className="mt-1 text-sm text-[#667085]">{draft.objective || "Add a business objective in Charter."}</p><div className="mt-3 flex flex-wrap gap-2 text-xs">{[draft.type, draft.priority, draft.governance, draft.mode === "open_discovery" ? "Open discovery" : "Closed repository"].map((x) => <span key={x} className="rounded-full border border-[#EDEDF0] bg-white px-2.5 py-1 text-[#475467]">{x}</span>)}</div></div>
      <div className="grid gap-4 md:grid-cols-2"><div><h3 className="mb-2 font-semibold">Organization</h3><p className="text-sm text-[#667085]">Sponsor: {draft.sponsor || "Not assigned"}<br />Lead: {draft.lead || "Not assigned"}<br />Departments: {draft.departments.join(", ") || "Not selected"}</p></div><div><h3 className="mb-2 font-semibold">Delivery</h3><p className="text-sm text-[#667085]">{draft.workstreams.length} workstreams · {draft.gates.length} gates · {draft.risks.length} risks</p><ul className="mt-1 list-inside list-disc text-sm text-[#667085]">{draft.workstreams.map((w, i) => <li key={i}>{w.name || "Unnamed workstream"} → {w.output || "Output to define"}</li>)}</ul></div></div>
      <div className="rounded-[14px] border border-[#EDEDF0] bg-white p-4"><h3 className="mb-1 font-semibold text-[#101D37]">Access permissions preview</h3><p className="mb-3 text-xs text-[#667085]">Generated from the charter above. People named in the charter receive access when they have an account.</p><dl className="grid gap-3 sm:grid-cols-2">{([["Visibility", draft.visibility], ["Information classification", draft.classification], ["Who can edit the plan", draft.plan_editing], ["Who manages access", draft.manage_access], ["Research approvals", draft.approvals], ["Change authorization", draft.change_authority], ["External partners can submit evidence", draft.external_partner_ingestion ? "Yes" : "No"], ["Sponsor and project lead", [draft.sponsor, draft.lead].filter(Boolean).join(" and ") || "Not assigned"]] as [string, string][]).map(([label, value]) => <div key={label}><dt className="text-xs font-medium text-[#667085]">{label}</dt><dd className="text-sm text-[#344054]">{value || "Not set"}</dd></div>)}</dl></div>
      <div className="rounded-[12px] border border-[#F79009]/30 bg-[#FFFAEB] p-3 text-sm text-[#7A2E0E]">AI suggestions are drafts. Confirm names, dates, owners, budgets, risks, approvals, and regulatory controls before creating the project.</div>
      {!ready && <div className="rounded-[12px] border border-[#FDA29B] bg-[#FEF3F2] p-3 text-sm text-[#B42318]"><p className="font-semibold">Complete these items before creating:</p><ul className="mt-1 list-inside list-disc">{missing.map((item) => <li key={item}>{item}</li>)}</ul></div>}
    </div>;
  };

  if (phase === "created") return <div className="flex min-h-dvh min-w-0 flex-1"><ProjectsPanel /><div className="flex min-w-0 flex-1 flex-col"><TopBar current="Project successfully initialized" trail={[{ label: "Projects", href: `${V2}/projects` }]} /><main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-10"><div className="flex flex-col items-center text-center"><span className="mb-4 flex size-14 items-center justify-center rounded-full bg-[#ECFDF3] text-2xl text-[#039855]">✓</span><h1 className="text-2xl font-semibold text-[#101D37]">Project successfully initialized!</h1><p role="status" className="mt-2 text-sm text-[#667085]">Opening the project…{uploadNote ? ` ${uploadNote}` : ""}</p><p className="mt-2 max-w-xl text-sm text-[#667085]">{draft.name} is saved with {draft.workstreams.length} draft research package{draft.workstreams.length === 1 ? "" : "s"}. Select sources and approve each package before asking research questions.</p></div>{insights && <AssessmentCard insights={insights} />}{!insights && insightsMissing && <p role="status" className="rounded-[12px] border border-[#EDEDF0] bg-white p-4 text-center text-sm text-[#667085]">The AI assessment could not be generated, so the project was saved without one. Your charter is complete.</p>}<div className="flex justify-center gap-3"><Link href={`${V2}/projects/${createdId}`} className="rounded-[10px] bg-blue px-4 py-2.5 text-sm font-semibold text-white">Open project</Link><Link href={`${V2}/projects`} className="rounded-[10px] border border-[#EDEDF0] bg-white px-4 py-2.5 text-sm font-medium text-[#344054]">Go to Projects</Link>{createdId && <span className="self-center text-xs text-[#667085]">ID {createdId.slice(0, 8)}</span>}</div></main></div></div>;

  return <div className="flex min-w-0 flex-1"><ProjectsPanel newLabel="New Project" /><div className="flex min-w-0 flex-1 flex-col"><TopBar current="New Project" trail={[{ label: "Projects", href: `${V2}/projects` }]} />
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-10">
      <div><Link href={`${V2}/projects`} className="text-sm font-medium text-blue">← Projects</Link><h1 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-[#101D37] sm:text-3xl">Create a research project</h1><p className="mt-1 text-sm text-[#667085]">Describe the outcome you need. AI will suggest a charter, plan and controls for you to review.</p></div>
      {phase === "prompt" && <form onSubmit={begin} className="rounded-[20px] border border-[#EDEDF0] bg-white p-5 sm:p-7"><div className="mb-4 flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-full bg-blue/[0.08] text-xl">✦</span><div><h2 className="font-semibold text-[#101D37]">Start with your idea</h2><p className="text-xs text-[#667085]">A sentence or short brief is enough to get started.</p></div></div><textarea autoFocus aria-label="Project idea" className={`${inputClass} min-h-36 resize-y`} value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={8000} placeholder="For example: Assess whether recovering waste heat at our manufacturing sites is technically and commercially viable, and recommend a pilot." />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <DictateButton label="Speak your idea" onText={(spoken) => setPrompt((old) => `${old}${old && !old.endsWith(" ") ? " " : ""}${spoken}`.slice(0, 8000))} />
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-[10px] border border-[#EDEDF0] bg-white px-3 py-1.5 text-sm font-medium text-[#344054]">Attach image<input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => addFiles(e, "image")} /></label><label className="inline-flex cursor-pointer items-center gap-2 rounded-[10px] border border-[#EDEDF0] bg-white px-3 py-1.5 text-sm font-medium text-[#344054]">Attach PDF<input type="file" accept="application/pdf,.pdf" multiple className="sr-only" onChange={(e) => addFiles(e, "pdf")} /></label>
          <span className="text-xs text-[#667085]">PDFs and images are added to the project when it is created.</span>
        </div>
        {files.length > 0 && <ul className="mt-2 flex flex-wrap gap-2">{files.map((name) => <li key={name} className="flex items-center gap-1.5 rounded-full border border-[#EDEDF0] bg-[#F8FAFC] px-3 py-1 text-xs text-[#344054]">{name}<button type="button" aria-label={`Remove ${name}`} onClick={() => { setFiles((old) => old.filter((x) => x !== name)); setPdfs((old) => old.filter((f) => f.name !== name)); setImages((old) => old.filter((f) => f.name !== name)); }} className="text-[#667085]">×</button></li>)}</ul>}<div className="mt-4 flex justify-end"><button disabled={!prompt.trim() || busy} className="rounded-[10px] bg-blue px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Preparing your project…" : "Start project setup →"}</button></div>{error && <p role="alert" className="mt-3 text-sm text-[#B42318]">{error} <button type="button" onClick={() => { setPhase("setup"); setSuggested([]); }} className="font-semibold underline">Continue without AI</button></p>}</form>}

      {phase === "chat" && <section className="flex flex-col gap-4 rounded-[20px] border border-[#EDEDF0] bg-white p-5 sm:p-7"><div><h2 className="font-semibold text-[#101D37]">Project setup assistant</h2><p className="text-xs text-[#667085]">It uses the configured research model. Suggestions stay editable until you create the project.</p></div><div className="flex max-h-[360px] flex-col gap-3 overflow-y-auto">{messages.map((m, i) => <div key={i} className={`max-w-[90%] whitespace-pre-line rounded-[16px] px-4 py-3 text-sm ${m.from === "user" ? "ml-auto bg-[#E8EEFC] text-[#101D37]" : "border border-[#EDEDF0] bg-white text-[#344054]"}`}>{m.text}</div>)}{busy && <div role="status" className="flex items-center gap-2 text-sm text-[#667085]"><span className="size-2 animate-pulse rounded-full bg-blue" />Thinking through your project…</div>}</div>{error && <div role="alert" className="rounded-[12px] border border-[#FDA29B] bg-[#FEF3F2] p-3 text-sm text-[#B42318]">{error} You can continue with your draft and fill the sections yourself.</div>}{questions.length > 0 && <QuestionCard questions={questions} onAnswer={answerQuestions} onSkip={skipQuestions} busy={busy} />}{!busy && questions.length === 0 && <div className="flex flex-wrap justify-between gap-3"><button type="button" onClick={() => { setPhase("setup"); setSection(0); }} className="rounded-[10px] bg-blue px-4 py-2.5 text-sm font-semibold text-white">Review suggested charter →</button>{error && <button type="button" onClick={() => { setPhase("setup"); setSection(0); }} className="rounded-[10px] border border-[#EDEDF0] px-4 py-2.5 text-sm font-medium">Continue manually</button>}</div>}</section>}

      {phase === "setup" && <><section className="rounded-[20px] border border-[#EDEDF0] bg-white px-4 py-5 sm:px-7"><Stepper active={section} onSelect={setSection} completed={Array.from({ length: 5 }, (_, i) => i).filter((i) => i < section)} /><h2 className="mt-6 text-xl font-semibold text-[#101D37]">{PROJECT_SECTIONS[section]}</h2><div className="mb-5 mt-1 flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-[#667085]">Review and edit every suggestion before you continue. Your draft is saved in this browser.</p><button type="button" onClick={startOver} className="text-sm font-medium text-[#B42318]">Discard draft</button></div>{content()}{Object.keys(suggestions).length > 0 && <div className="mt-6 rounded-[14px] border border-blue/20 bg-blue/[0.03] p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-[#101D37]">AI suggestions</h3>
          <div className="flex gap-2"><button type="button" onClick={useAllSuggestions} className="rounded-[10px] bg-blue px-3 py-1.5 text-sm font-semibold text-white">Use all</button>
          <button type="button" onClick={() => setSuggestions({})} className="rounded-[10px] border border-[#EDEDF0] bg-white px-3 py-1.5 text-sm font-medium text-[#344054]">Dismiss all</button></div></div>
        <p className="mb-2 text-xs text-[#667085]">Edit any suggestion, then use it to paste it into the field. Nothing changes until you choose Use.</p>
        {Object.entries(suggestions).map(([key, text]) => <div key={key} className="grid gap-2 border-t border-[#EDEDF0] py-3 md:grid-cols-[200px_1fr] md:items-start">
          <span className="pt-2 text-sm font-semibold text-[#101D37]">{labelOf(key)}</span>
          <div className="flex flex-col gap-2">
            <textarea aria-label={`Suggestion for ${labelOf(key)}`} value={text} onChange={(e) => setSuggestions((old) => ({ ...old, [key]: e.target.value }))} className={`${inputClass} min-h-16 resize-y`} />
            <div className="flex gap-2"><button type="button" onClick={() => useSuggestion(key)} className="rounded-[10px] bg-blue px-3 py-1.5 text-sm font-semibold text-white">Use</button>
            <button type="button" onClick={() => dropSuggestion(key)} className="rounded-[10px] border border-[#EDEDF0] bg-white px-3 py-1.5 text-sm font-medium text-[#344054]">Dismiss</button></div>
          </div>
        </div>)}
      </div>}
<div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-[#EDEDF0] pt-4"><button type="button" onClick={() => section === 0 ? setPhase("chat") : setSection(section - 1)} className="rounded-[10px] border border-[#EDEDF0] px-4 py-2 text-sm font-medium text-[#344054]">{section === 0 ? "← Back to conversation" : "← Previous"}</button><div className="flex items-center gap-3"><button type="button" onClick={() => void saveDraft()} disabled={savingDraft} className="rounded-[10px] border border-[#EDEDF0] px-4 py-2 text-sm font-medium text-[#344054] disabled:opacity-50">{savingDraft ? "Saving draft…" : "Save Draft"}</button>{draftId && <button type="button" onClick={() => void deleteDraft()} className="rounded-[10px] border border-[#FDA29B] px-4 py-2 text-sm font-medium text-[#B42318]">Delete draft</button>}{section < 4 && <button type="button" onClick={() => void suggestStep()} disabled={suggesting || busy} className="rounded-[10px] border border-blue/30 bg-blue/[0.04] px-4 py-2 text-sm font-medium text-blue disabled:opacity-50">{suggesting ? "Suggesting…" : "Suggest with AI"}</button>}{draftNote && <span role="status" className="text-xs text-[#667085]">Draft saved.</span>}{section < 4 ? <button type="button" onClick={() => setSection(section + 1)} className="rounded-[10px] bg-blue px-4 py-2 text-sm font-semibold text-white">{section === 3 ? "Confirm & Review →" : "Confirm & Continue →"}</button> : <button type="button" onClick={() => void create()} disabled={!ready || busy} className="rounded-[10px] bg-blue px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Creating project…" : "Create project"}</button>}</div></div>{saveError && <p role="alert" className="mt-3 text-sm text-[#B42318]">{saveError}</p>}</section>
        <form onSubmit={editWithAi} className="flex gap-2 rounded-[16px] border border-[#EDEDF0] bg-white p-3"><input name="change" maxLength={1000} className={inputClass} placeholder="Ask AI to adjust the project plan…" /><button disabled={busy} className="shrink-0 rounded-[10px] bg-[#101D37] px-4 py-2 text-sm font-semibold text-white">{busy ? "…" : "Ask AI"}</button></form>
        </>}
    </main></div></div>;
}
