"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useProjects } from "@/components/v2/V2Frame";
import TopBar from "@/components/v2/dashboard/TopBar";
import ProjectsPanel from "@/components/v2/dashboard/ProjectsPanel";
import AssessmentCard from "@/components/v2/projects/AssessmentCard";
import DictateButton from "@/components/v2/projects/DictateButton";
import { api } from "@/lib/api";
import {
  EMPTY_PROJECT_DRAFT,
  PROJECT_SECTIONS,
  type IntakeResponse,
  type ProjectDraft,
  type ProjectInsights,
  type ProjectQuestion,
} from "@/lib/projectIntake";
import { clearProjectDraft, readProjectDraft, writeProjectDraft } from "@/lib/projectDraftStore";
import { V2 } from "@/lib/v2/routes";

type ChatMessage = { from: "ai" | "user"; text: string };
const DEPARTMENTS = [
  "Research & Development", "Engineering", "Quality & Regulatory Affairs", "Manufacturing",
  "Operations", "Commercial & Marketing", "Finance", "Procurement & Supply Chain",
  "Legal", "Digital & Information Technology", "Project Management Office", "Health, Safety & Environment",
];
const REG_CONTROLS = ["Independent acceptance", "Evidence traceability", "Record decisions and changes"];
const inputClass = "w-full rounded-[10px] border border-[#EDEDF0] bg-white px-3 py-2.5 text-sm text-[#101D37] outline-none transition focus:border-blue focus:ring-2 focus:ring-blue/10";
const labelClass = "mb-1.5 block text-sm font-medium text-[#344054]";

function Field({ label, suggested, children }: { label: string; suggested?: boolean; children: ReactNode }) {
  return <div className="block"><span className={labelClass}>{label}{suggested && <span className="ml-2 rounded-md bg-blue/[0.08] px-1.5 py-0.5 text-[11px] font-semibold text-blue">AI Suggested · review</span>}</span>{children}</div>;
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

function QuestionCard({ questions, onAnswer, onSkip, busy }: {
  questions: ProjectQuestion[]; onAnswer: (answers: string) => void; onSkip: () => void; busy: boolean;
}) {
  const [selected, setSelected] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const toggle = (i: number, value: string, multi: boolean) => setSelected((old) => {
    const current = old[i] ?? [];
    return { ...old, [i]: multi ? (current.includes(value) ? current.filter((v) => v !== value) : [...current, value]) : [value] };
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onAnswer(questions.map((q, i) => `Q: ${q.question}\nA: ${[...(selected[i] ?? []), other[i]?.trim()].filter(Boolean).join(", ") || "Not sure yet"}`).join("\n\n"));
  };
  return <form onSubmit={submit} className="flex flex-col gap-4 rounded-[16px] bg-[#FAFAFA] p-4">
    {questions.map((q, i) => <fieldset key={`${q.header}-${i}`} className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold text-[#101D37]">{q.question}</legend>
      {q.options.map((o) => {
        const checked = (selected[i] ?? []).includes(o.label);
        return <button key={o.label} type="button" onClick={() => toggle(i, o.label, q.multi_select)}
          aria-pressed={checked} className={`flex items-start gap-2 rounded-[10px] border p-3 text-left text-sm ${checked ? "border-blue bg-blue/[0.04]" : "border-[#EDEDF0] bg-white"}`}>
          <span className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${checked ? "border-blue bg-blue text-[10px] text-white" : "border-[#D0D5DD]"}`}>{checked ? "✓" : ""}</span>
          <span><span className="font-medium text-[#101D37]">{o.label}</span>{o.description && <span className="mt-0.5 block text-xs text-[#667085]">{o.description}</span>}</span>
        </button>;
      })}
      <input className={inputClass} placeholder="Other / add a note" value={other[i] ?? ""} onChange={(e) => setOther((x) => ({ ...x, [i]: e.target.value }))} />
    </fieldset>)}
    <div className="flex flex-wrap justify-between gap-2"><button type="button" onClick={onSkip} disabled={busy} className="text-sm font-medium text-[#667085]">Skip questions and draft the rest</button><button disabled={busy} className="rounded-[10px] bg-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Thinking…" : "Send answers"}</button></div>
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
    }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated || phase === "created") return;
    if (phase === "prompt" && !prompt.trim() && files.length === 0) { clearProjectDraft(); return; }
    writeProjectDraft({ v: 1, phase, prompt, files, draft, section, messages, questions, asked, suggested, round });
  }, [hydrated, phase, prompt, files, draft, section, messages, questions, asked, suggested, round]);

  const startOver = () => {
    clearProjectDraft();
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
    await runIntake("edit", text, next, draft, round);
  };

  const missing: string[] = [];
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
      brief: JSON.stringify({ objective: draft.objective, workstream: w, approach: draft.approach, reporting: draft.reporting, dependencies: draft.dependencies }),
    }));
    try {
      const project = await api.createProjectComplete({ name: draft.name, mode: draft.mode, meta, charter: draft, work_packages, insights: assessment ?? undefined });
      setInsights(assessment); setCreatedId(project.id); clearProjectDraft(); setPhase("created"); await reload();
    } catch (e) { setSaveError(e instanceof Error ? e.message : "Could not create project."); }
    finally { setBusy(false); }
  };

  const field = (key: keyof ProjectDraft, title: string, multiline = false, type = "text") => {
    const value = key === "teams" ? draft.teams.join("\n") : textValue(draft[key]);
    const change = (next: string) => update(key, (key === "teams" ? next.split("\n").map((x) => x.trim()).filter(Boolean) : next) as never);
    return <Field key={key} label={title} suggested={suggested.includes(key)}>
      {multiline ? <textarea aria-label={title} className={`${inputClass} min-h-24 resize-y`} value={value} onChange={(e) => change(e.target.value)} />
        : <input aria-label={title} type={type} className={inputClass} value={value} onChange={(e) => change(e.target.value)} />}
    </Field>;
  };

  const content = () => {
    if (section === 0) return <div className="grid gap-4 md:grid-cols-2">
      {field("name", "Project name")}
      <Field label="Project type" suggested={suggested.includes("type")}><select aria-label="Project type" className={inputClass} value={draft.type} onChange={(e) => update("type", e.target.value)}>{["Research & Development", "Engineering & Validation", "Technology Evaluation", "Regulatory & Quality", "Operational Change", "Commercial Assessment", "Other"].map((x) => <option key={x}>{x}</option>)}</select></Field>
      <div className="md:col-span-2">{field("objective", "Business objective", true)}</div>
      <div className="md:col-span-2">{field("background", "Background and context", true)}</div>
      {field("priority", "Priority")}{field("programme", "Programme / portfolio")}{field("business_unit", "Business unit")}
      {field("start", "Planned start", false, "date")}{field("target", "Target completion", false, "date")}
      <div className="md:col-span-2">{field("in_scope", "In scope", true)}{field("out_scope", "Out of scope", true)}</div>
      {field("deliverable", "Key deliverable", true)}{field("measures", "Success measures", true)}
      {field("assumptions", "Assumptions", true)}{field("dependencies", "Dependencies", true)}
    </div>;
    if (section === 1) return <div className="grid gap-4 md:grid-cols-2">
      {field("sponsor", "Project sponsor")}{field("lead", "Accountable project lead")}
      <Field label="Participating departments" suggested={suggested.includes("departments")}><div className="grid gap-2 sm:grid-cols-2">{DEPARTMENTS.map((d) => <label key={d} className="flex items-center gap-2 text-sm text-[#344054]"><input type="checkbox" checked={draft.departments.includes(d)} onChange={(e) => update("departments", e.target.checked ? [...draft.departments, d] : draft.departments.filter((x) => x !== d))} />{d}</label>)}</div></Field>
      <div className="flex flex-col gap-4"><Field label="Team assignment"><select aria-label="Team assignment" className={inputClass} value={draft.team_mode} onChange={(e) => update("team_mode", e.target.value)}><option>Assign participating teams now</option><option>Department leads assign their teams later</option></select></Field>{field("teams", "Participating teams (one per line)", true)}{field("stakeholders", "Key stakeholders", true)}{field("decision_notes", "Stakeholder and decision notes", true)}{field("external_orgs", "External organizations", true)}</div>
    </div>;
    if (section === 2) return <div className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-2"><Field label="Research mode" suggested><p aria-label="Research mode" className={`${inputClass} bg-[#FAFAFA] text-[#475467]`}>{draft.mode === "closed_repository" ? "Closed repository · uses approved sources only" : "Open discovery · searches scholarly sources"}</p></Field>{field("approach", "Delivery approach")}{field("reporting", "Reporting cadence")}{field("budget", "Budget / cost range")}{field("currency", "Currency")}{field("resources", "Resource assumptions", true)}</div>
      <div className="rounded-[14px] border border-[#EDEDF0] p-4"><div className="mb-3 flex items-center justify-between"><div><h3 className="font-semibold text-[#101D37]">Workstreams</h3><p className="text-xs text-[#667085]">Each workstream becomes a draft research package.</p></div><button type="button" onClick={() => update("workstreams", [...draft.workstreams, { name: "", department: "", team: "", output: "", owner: "", reviewer: "", start: "", due: "", dependencies: "" }])} className="rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm font-medium">+ Add workstream</button></div>
        {draft.workstreams.map((w, i) => <div key={i} className="mb-4 grid gap-3 border-t border-[#EDEDF0] pt-4 md:grid-cols-2">{(["name", "department", "team", "output", "owner", "reviewer"] as const).map((k) => { const label = k === "name" ? `Workstream ${i + 1}` : `Workstream ${i + 1} ${k}`; return <Field key={k} label={label} suggested={suggested.includes("workstreams")}><input aria-label={label} className={inputClass} value={w[k]} onChange={(e) => update("workstreams", draft.workstreams.map((x, j) => j === i ? { ...x, [k]: e.target.value } : x))} /></Field>; })}<button type="button" onClick={() => update("workstreams", draft.workstreams.filter((_, j) => j !== i))} className="text-left text-sm text-[#B42318]">Remove workstream</button></div>)}
      </div>
      <div className="rounded-[14px] border border-[#EDEDF0] p-4"><div className="mb-3 flex items-center justify-between"><div><h3 className="font-semibold text-[#101D37]">Decision gates</h3><p className="text-xs text-[#667085]">Add the checks needed before decisions.</p></div><button type="button" onClick={() => update("gates", [...draft.gates, { name: "", owner: "", approver: "", date: "", criteria: "", workstreams: [] }])} className="rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm font-medium">+ Add gate</button></div>{draft.gates.map((g, i) => <div key={i} className="mb-4 grid gap-3 border-t border-[#EDEDF0] pt-4 md:grid-cols-2">{(["name", "owner", "approver", "date", "criteria"] as const).map((k) => <Field key={k} label={`Gate ${i + 1} · ${k}`} suggested={suggested.includes("gates")}><input aria-label={`Gate ${i + 1} ${k}`} type={k === "date" ? "date" : "text"} className={inputClass} value={g[k]} onChange={(e) => update("gates", draft.gates.map((x, j) => j === i ? { ...x, [k]: e.target.value } : x))} /></Field>)}<fieldset className="flex flex-col gap-2"><legend className="text-sm font-medium">Workstreams covered</legend>{draft.workstreams.map((w, wi) => <label key={wi} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={g.workstreams.includes(w.name)} onChange={(e) => update("gates", draft.gates.map((x, j) => j === i ? { ...x, workstreams: e.target.checked ? [...x.workstreams, w.name] : x.workstreams.filter((n) => n !== w.name) } : x))} />{w.name || `Workstream ${wi + 1}`}</label>)}</fieldset><button type="button" onClick={() => update("gates", draft.gates.filter((_, j) => j !== i))} className="text-left text-sm text-[#B42318]">Remove gate</button></div>)}</div>
      <div className="rounded-[14px] border border-[#EDEDF0] p-4"><div className="mb-3 flex items-center justify-between"><div><h3 className="font-semibold text-[#101D37]">Risk register</h3><p className="text-xs text-[#667085]">Risks remain proposals until your team reviews them.</p></div><button type="button" onClick={() => update("risks", [...draft.risks, { risk: "", owner: "", severity: "Medium", response: "" }])} className="rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm font-medium">+ Add risk</button></div>{draft.risks.map((r, i) => <div key={i} className="mb-4 grid gap-3 border-t border-[#EDEDF0] pt-4 md:grid-cols-2">{(["risk", "owner", "severity", "response"] as const).map((k) => <Field key={k} label={`Risk ${i + 1} · ${k}`} suggested={suggested.includes("risks")}><input aria-label={`Risk ${i + 1} ${k}`} className={inputClass} value={r[k]} onChange={(e) => update("risks", draft.risks.map((x, j) => j === i ? { ...x, [k]: e.target.value } : x))} /></Field>)}<button type="button" onClick={() => update("risks", draft.risks.filter((_, j) => j !== i))} className="text-left text-sm text-[#B42318]">Remove risk</button></div>)}{field("no_risk_reason", "If none, explain why this project has no significant risks", true)}</div>
    </div>;
    if (section === 3) return <div className="grid gap-4 md:grid-cols-2">
      {field("governance", "Governance level")}{field("controls_mode", "Controls profile")}
      <Field label="Project visibility"><select aria-label="Project visibility" className={inputClass} value={draft.visibility} onChange={(e) => update("visibility", e.target.value)}>{["Project members only", "Organization summary"].map((x) => <option key={x}>{x}</option>)}</select></Field>
      <Field label="Information classification"><select aria-label="Information classification" className={inputClass} value={draft.classification} onChange={(e) => update("classification", e.target.value)}>{["Internal", "Confidential", "Restricted", "Public"].map((x) => <option key={x}>{x}</option>)}</select></Field>
      {field("plan_editing", "Who can edit the plan")}{field("manage_access", "Who manages access")}{field("approvals", "Research approvals")}{field("change_authority", "Change authorization")}
      {field("standards", "Applicable standards and regulations", true)}{field("quality_lead", "Quality lead")}{field("gate_rule", "Gate approval rule")}
      <Field label="Quality and assurance checks" suggested={suggested.includes("reg_controls")}><div className="flex flex-col gap-2">{REG_CONTROLS.map((x) => <label key={x} className="flex items-center gap-2 text-sm text-[#344054]"><input type="checkbox" checked={draft.reg_controls.includes(x)} onChange={(e) => update("reg_controls", e.target.checked ? [...draft.reg_controls, x] : draft.reg_controls.filter((c) => c !== x))} />{x}</label>)}</div></Field>
      {field("data_location", "Data location")}{field("retention", "Record retention")}
      <Field label="External access"><select aria-label="External access" className={inputClass} value={draft.external_access} onChange={(e) => update("external_access", e.target.value)}>{["No external access", "Named external reviewers", "Named external contributors"].map((x) => <option key={x}>{x}</option>)}</select></Field>
    </div>;
    return <div className="flex flex-col gap-5">
      <div className="rounded-[14px] bg-[#F8FAFC] p-4"><h3 className="font-semibold text-[#101D37]">{draft.name || "Untitled project"}</h3><p className="mt-1 text-sm text-[#667085]">{draft.objective || "Add a business objective in Charter."}</p><div className="mt-3 flex flex-wrap gap-2 text-xs">{[draft.type, draft.priority, draft.governance, draft.mode === "open_discovery" ? "Open discovery" : "Closed repository"].map((x) => <span key={x} className="rounded-full border border-[#EDEDF0] bg-white px-2.5 py-1 text-[#475467]">{x}</span>)}</div></div>
      <div className="grid gap-4 md:grid-cols-2"><div><h3 className="mb-2 font-semibold">Organization</h3><p className="text-sm text-[#667085]">Sponsor: {draft.sponsor || "Not assigned"}<br />Lead: {draft.lead || "Not assigned"}<br />Departments: {draft.departments.join(", ") || "Not selected"}</p></div><div><h3 className="mb-2 font-semibold">Delivery</h3><p className="text-sm text-[#667085]">{draft.workstreams.length} workstreams · {draft.gates.length} gates · {draft.risks.length} risks</p><ul className="mt-1 list-inside list-disc text-sm text-[#667085]">{draft.workstreams.map((w, i) => <li key={i}>{w.name || "Unnamed workstream"} → {w.output || "Output to define"}</li>)}</ul></div></div>
      <div className="rounded-[12px] border border-[#F79009]/30 bg-[#FFFAEB] p-3 text-sm text-[#7A2E0E]">AI suggestions are drafts. Confirm names, dates, owners, budgets, risks, approvals, and regulatory controls before creating the project.</div>
      {!ready && <div className="rounded-[12px] border border-[#FDA29B] bg-[#FEF3F2] p-3 text-sm text-[#B42318]"><p className="font-semibold">Complete these items before creating:</p><ul className="mt-1 list-inside list-disc">{missing.map((item) => <li key={item}>{item}</li>)}</ul></div>}
    </div>;
  };

  if (phase === "created") return <div className="flex min-h-dvh min-w-0 flex-1"><ProjectsPanel /><div className="flex min-w-0 flex-1 flex-col"><TopBar current="Project created" trail={[{ label: "Projects", href: `${V2}/projects` }]} /><main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-10"><div className="flex flex-col items-center text-center"><span className="mb-4 flex size-14 items-center justify-center rounded-full bg-[#ECFDF3] text-2xl text-[#039855]">✓</span><h1 className="text-2xl font-semibold text-[#101D37]">Project created</h1><p className="mt-2 max-w-xl text-sm text-[#667085]">{draft.name} is saved with {draft.workstreams.length} draft research package{draft.workstreams.length === 1 ? "" : "s"}. Select sources and approve each package before asking research questions.</p></div>{insights && <AssessmentCard insights={insights} />}{!insights && insightsMissing && <p role="status" className="rounded-[12px] border border-[#EDEDF0] bg-white p-4 text-center text-sm text-[#667085]">The AI assessment could not be generated, so the project was saved without one. Your charter is complete.</p>}<div className="flex justify-center gap-3"><Link href={`${V2}/projects/${createdId}`} className="rounded-[10px] bg-blue px-4 py-2.5 text-sm font-semibold text-white">Open project</Link><Link href={`${V2}/projects`} className="rounded-[10px] border border-[#EDEDF0] bg-white px-4 py-2.5 text-sm font-medium text-[#344054]">Go to Projects</Link>{createdId && <span className="self-center text-xs text-[#667085]">ID {createdId.slice(0, 8)}</span>}</div></main></div></div>;

  return <div className="flex min-w-0 flex-1"><ProjectsPanel newLabel="New Project" /><div className="flex min-w-0 flex-1 flex-col"><TopBar current="New Project" trail={[{ label: "Projects", href: `${V2}/projects` }]} />
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-10">
      <div><Link href={`${V2}/projects`} className="text-sm font-medium text-blue">← Projects</Link><h1 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-[#101D37] sm:text-3xl">Create a research project</h1><p className="mt-1 text-sm text-[#667085]">Describe the outcome you need. AI will suggest a charter, plan and controls for you to review.</p></div>
      {phase === "prompt" && <form onSubmit={begin} className="rounded-[20px] border border-[#EDEDF0] bg-white p-5 sm:p-7"><div className="mb-4 flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-full bg-blue/[0.08] text-xl">✦</span><div><h2 className="font-semibold text-[#101D37]">Start with your idea</h2><p className="text-xs text-[#667085]">A sentence or short brief is enough to get started.</p></div></div><textarea autoFocus aria-label="Project idea" className={`${inputClass} min-h-36 resize-y`} value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={8000} placeholder="For example: Assess whether recovering waste heat at our manufacturing sites is technically and commercially viable, and recommend a pilot." />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <DictateButton label="Speak your idea" onText={(spoken) => setPrompt((old) => `${old}${old && !old.endsWith(" ") ? " " : ""}${spoken}`.slice(0, 8000))} />
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-[10px] border border-[#EDEDF0] bg-white px-3 py-1.5 text-sm font-medium text-[#344054]">
            + Attach files
            <input type="file" multiple className="sr-only" onChange={(e) => {
              const names = Array.from(e.target.files ?? []).map((f) => f.name);
              setFiles((old) => [...new Set([...old, ...names])].slice(0, 10));
              e.target.value = "";
            }} />
          </label>
          <span className="text-xs text-[#667085]">Attached file names are added to your brief. Their contents are not read yet.</span>
        </div>
        {files.length > 0 && <ul className="mt-2 flex flex-wrap gap-2">{files.map((name) => <li key={name} className="flex items-center gap-1.5 rounded-full border border-[#EDEDF0] bg-[#F8FAFC] px-3 py-1 text-xs text-[#344054]">{name}<button type="button" aria-label={`Remove ${name}`} onClick={() => setFiles((old) => old.filter((x) => x !== name))} className="text-[#667085]">×</button></li>)}</ul>}<div className="mt-4 flex justify-end"><button disabled={!prompt.trim() || busy} className="rounded-[10px] bg-blue px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Preparing your project…" : "Start project setup →"}</button></div>{error && <p role="alert" className="mt-3 text-sm text-[#B42318]">{error} <button type="button" onClick={() => { setPhase("setup"); setSuggested([]); }} className="font-semibold underline">Continue without AI</button></p>}</form>}

      {phase === "chat" && <section className="flex flex-col gap-4 rounded-[20px] border border-[#EDEDF0] bg-white p-5 sm:p-7"><div><h2 className="font-semibold text-[#101D37]">Project setup assistant</h2><p className="text-xs text-[#667085]">It uses the configured research model. Suggestions stay editable until you create the project.</p></div><div className="flex max-h-[360px] flex-col gap-3 overflow-y-auto">{messages.map((m, i) => <div key={i} className={`max-w-[90%] whitespace-pre-line rounded-[16px] px-4 py-3 text-sm ${m.from === "user" ? "ml-auto bg-[#E8EEFC] text-[#101D37]" : "border border-[#EDEDF0] bg-white text-[#344054]"}`}>{m.text}</div>)}{busy && <div role="status" className="flex items-center gap-2 text-sm text-[#667085]"><span className="size-2 animate-pulse rounded-full bg-blue" />Thinking through your project…</div>}</div>{error && <div role="alert" className="rounded-[12px] border border-[#FDA29B] bg-[#FEF3F2] p-3 text-sm text-[#B42318]">{error} You can continue with your draft and fill the sections yourself.</div>}{questions.length > 0 && <QuestionCard questions={questions} onAnswer={answerQuestions} onSkip={skipQuestions} busy={busy} />}{!busy && questions.length === 0 && <div className="flex flex-wrap justify-between gap-3"><button type="button" onClick={() => { setPhase("setup"); setSection(0); }} className="rounded-[10px] bg-blue px-4 py-2.5 text-sm font-semibold text-white">Review suggested charter →</button>{error && <button type="button" onClick={() => { setPhase("setup"); setSection(0); }} className="rounded-[10px] border border-[#EDEDF0] px-4 py-2.5 text-sm font-medium">Continue manually</button>}</div>}</section>}

      {phase === "setup" && <><section className="rounded-[20px] border border-[#EDEDF0] bg-white px-4 py-5 sm:px-7"><Stepper active={section} onSelect={setSection} completed={Array.from({ length: 5 }, (_, i) => i).filter((i) => i < section)} /><h2 className="mt-6 text-xl font-semibold text-[#101D37]">{PROJECT_SECTIONS[section]}</h2><div className="mb-5 mt-1 flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-[#667085]">Review and edit every suggestion before you continue. Your draft is saved in this browser.</p><button type="button" onClick={startOver} className="text-sm font-medium text-[#B42318]">Discard draft</button></div>{content()}<div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-[#EDEDF0] pt-4"><button type="button" onClick={() => section === 0 ? setPhase("chat") : setSection(section - 1)} className="rounded-[10px] border border-[#EDEDF0] px-4 py-2 text-sm font-medium text-[#344054]">{section === 0 ? "← Back to conversation" : "← Previous"}</button>{section < 4 ? <button type="button" onClick={() => setSection(section + 1)} className="rounded-[10px] bg-blue px-4 py-2 text-sm font-semibold text-white">{section === 3 ? "Review project →" : "Continue →"}</button> : <button type="button" onClick={() => void create()} disabled={!ready || busy} className="rounded-[10px] bg-blue px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Creating project…" : "Create project"}</button>}</div>{saveError && <p role="alert" className="mt-3 text-sm text-[#B42318]">{saveError}</p>}</section>
        <form onSubmit={editWithAi} className="flex gap-2 rounded-[16px] border border-[#EDEDF0] bg-white p-3"><input name="change" className={inputClass} placeholder="Ask AI to adjust the project plan…" /><button disabled={busy} className="shrink-0 rounded-[10px] bg-[#101D37] px-4 py-2 text-sm font-semibold text-white">{busy ? "…" : "Ask AI"}</button></form>
        </>}
    </main></div></div>;
}
