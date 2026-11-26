"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import TopBar from "@/components/v2/dashboard/TopBar";
import ProjectsPanel from "@/components/v2/dashboard/ProjectsPanel";
import { useProjects } from "@/components/v2/V2Frame";
import { STATUS_CLS, Stat, dateLabel, priorityChip, projectText } from "@/components/v2/projects/overviewShared";
import { api } from "@/lib/api";
import { workPackage } from "@/lib/workPackages";
import type { DecisionGate, TaskRow } from "@/lib/types";
import { V2 } from "@/lib/v2/routes";

/** The stages a work package moves through; the same values the database accepts. */
const STAGES = ["Discovery", "Validation", "Business Case", "Decided"] as const;

/** One work package's own overview: the fields entered for it, its research, and its gates. The project's shared context is collapsed at the bottom. */
export default function WorkPackageOverview({ projectId, taskId }: { projectId: string; taskId: string }) {
  const { projects, loading, error } = useProjects();
  const project = projects.find((p) => p.id === projectId || p.slug === projectId);
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [tasksError, setTasksError] = useState("");
  const [research, setResearch] = useState<{ status: string; papers: number | null; uploads: number | null } | null>(null);
  const [researchError, setResearchError] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [stageDraft, setStageDraft] = useState("Discovery");
  const [progressDraft, setProgressDraft] = useState("0");
  const [saving, setSaving] = useState(false);
  const [stageError, setStageError] = useState("");
  const [gates, setGates] = useState<DecisionGate[]>([]);

  useEffect(() => {
    let live = true;
    api.tasks(projectId)
      .then((rows) => { if (live) setTasks(rows); })
      .catch((e) => { if (live) setTasksError(e instanceof Error ? e.message : "Could not load the work package."); });
    api.projectGates(projectId).then((rows) => { if (live) setGates(rows); }).catch(() => { if (live) setGates([]); });
    return () => { live = false; };
  }, [projectId]);

  const loadResearch = async () => {
    try {
      const d = await api.projectEvidence(projectId);
      const run = d.runs.find((r) => r.task_id === taskId);
      setResearch(run ? { status: run.status, papers: run.sources?.papers ?? null, uploads: run.sources?.uploads ?? null } : { status: "", papers: null, uploads: null });
    } catch {
      setResearch(null);
    }
  };
  useEffect(() => { void loadResearch(); }, [projectId, taskId]);
  const researching = research?.status === "queued" || research?.status === "running";
  useEffect(() => {
    if (!researching) return;
    const timer = setInterval(() => void loadResearch(), 4000);
    return () => clearInterval(timer);
  }, [researching]);

  const [starting, setStarting] = useState(false);
  const startResearch = async () => {
    setResearchError("");
    setStarting(true);
    try { await api.runTaskEvidence(taskId); } catch (e) { setResearchError(e instanceof Error ? e.message : "The research could not be started."); }
    finally { setStarting(false); }
    await loadResearch();
  };
  const download = () => {
    setDownloadError("");
    api.downloadWorkPackageDocument(taskId).catch((e) => setDownloadError(e instanceof Error ? e.message : "Could not create the Word document."));
  };

  const task = tasks?.find((t) => t.id === taskId);
  const wp = task ? workPackage(task) : null;
  useEffect(() => {
    if (!wp) return;
    setStageDraft(wp.stage ?? "Discovery");
    setProgressDraft(String(wp.progress ?? 0));
    // Only when the stored values change; typing in the form must not be overwritten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wp?.stage, wp?.progress]);
  const saveStage = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true); setStageError("");
    try {
      await api.updateWorkPackage(taskId, { stage: stageDraft, progress: Math.min(100, Math.max(0, Number(progressDraft) || 0)) });
      setTasks(await api.tasks(projectId));
    } catch (err) {
      setStageError(err instanceof Error ? err.message : "The stage could not be saved.");
    } finally { setSaving(false); }
  };
  // A gate's scope is the workstream names it covers, joined with ", " when saved.
  const packageGates = gates.filter((g) => wp && (g.gate_scope ?? "").split(", ").includes(wp.title));
  const priority = priorityChip(projectText(project?.meta, "priority"));
  const researchLabel = research?.status === "queued" || research?.status === "running" ? "Researching…"
    : research?.status === "complete" ? "Run again" : research?.status === "failed" ? "Retry" : "Start research";

  const fields: [string, string][] = wp ? [
    ["Owner", wp.owner],
    ["Reviewer", wp.reviewer],
    ["Department", wp.department],
    ["Team", wp.team],
    ["Expected output", wp.output],
    ["Start", dateLabel(wp.start)],
    ["Due", dateLabel(wp.due)],
    ["Depends on", wp.dependsOn.length ? wp.dependsOn.join(", ") : wp.dependencies],
  ].filter(([, value]) => value !== "") as [string, string][] : [];

  const inherited: [string, string][] = [
    ["Project type", projectText(project?.meta, "type")],
    ["Sponsor", projectText(project?.meta, "sponsor")],
    ["Governance", projectText(project?.meta, "governance")],
    ["Target completion", projectText(project?.meta, "target")],
    ["In scope", projectText(project?.meta, "in_scope")],
    ["Out of scope", projectText(project?.meta, "out_scope")],
  ].filter(([, value]) => value) as [string, string][];

  return <div className="flex min-w-0 flex-1">
    <ProjectsPanel activeId={projectId} showWorkPackages activeSection="overview" />
    <div className="flex min-w-0 flex-1 flex-col">
      <TopBar current="Overview" trail={[
        { label: "Projects", href: `${V2}/projects` },
        { label: project?.name ?? "Project", href: `${V2}/projects/${projectId}` },
      ]} />
      <main className="flex flex-col gap-5 px-4 pt-8 pb-16 sm:px-6 lg:px-10">
        {loading || tasks === null && !tasksError ? <p className="text-sm text-[#667085]">Loading work package…</p>
          : error ? <p role="alert" className="text-sm text-[#B42318]">Could not load project: {error}</p>
          : tasksError ? <p role="alert" className="text-sm text-[#B42318]">{tasksError}</p>
          : !wp ? <p className="text-sm text-[#667085]">Work package not found.</p> : <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-[#667085]">{[wp.code, project?.name].filter(Boolean).join(" · ")}</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-[#101D37] sm:text-3xl">{wp.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded-md px-2 py-1 font-medium ${STATUS_CLS[wp.status] ?? "bg-[#F2F4F7] text-[#475467]"}`}>{wp.status}</span>
                {wp.stage && <span className="rounded-md border border-[#EDEDF0] px-2 py-1 text-[#344054]">{wp.stage}</span>}
                <span className={`rounded-md px-2 py-1 font-medium ${priority.cls}`}>{priority.text}</span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="flex flex-wrap gap-2">
                <Link href={`${V2}/projects/${projectId}/workspace/${taskId}`} className="rounded-[10px] border border-[#EDEDF0] bg-white px-4 py-2.5 text-sm font-semibold text-[#101D37]">Open workspace</Link>
                <button type="button" onClick={download} className="rounded-[10px] border border-[#EDEDF0] bg-white px-4 py-2.5 text-sm font-semibold text-[#101D37]">Download Word document</button>
              </div>
              {downloadError && <p role="alert" className="text-xs text-[#B42318]">{downloadError}</p>}
            </div>
          </div>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat value={wp.progress === null ? "—" : `${wp.progress}%`} label="Progress" />
            <Stat value={research ? String(research.papers ?? 0) : "—"} label="Papers selected" />
            <Stat value={research ? String(research.uploads ?? 0) : "—"} label="Uploads" />
            <Stat value={String(packageGates.length)} label="Decision Gates" />
          </section>

          <section className="rounded-[20px] border border-[#EDEDF0] bg-white p-5">
            <h2 className="text-lg font-semibold text-[#101D37]">Details</h2>
            {fields.length === 0 ? <p className="mt-4 text-sm text-[#667085]">No details were entered for this work package.</p> : <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              {fields.map(([label, value]) => <div key={label}><dt className="text-xs font-medium text-[#667085]">{label}</dt><dd className="mt-1 whitespace-pre-line text-sm text-[#344054]">{value}</dd></div>)}
            </dl>}
          </section>

          {wp.code && <section className="rounded-[20px] border border-[#EDEDF0] bg-white p-5">
            <h2 className="text-lg font-semibold text-[#101D37]">Stage and progress</h2>
            <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={saveStage}>
              <label className="flex flex-col gap-1 text-xs font-medium text-[#667085]">Stage
                <select value={stageDraft} onChange={(e) => setStageDraft(e.target.value)} className="rounded-[10px] border border-[#EDEDF0] px-3 py-2 text-sm text-[#101D37]">
                  {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-[#667085]">Progress (%)
                <input type="number" min={0} max={100} value={progressDraft} onChange={(e) => setProgressDraft(e.target.value)}
                  className="w-24 rounded-[10px] border border-[#EDEDF0] px-3 py-2 text-sm text-[#101D37]" />
              </label>
              <button type="submit" disabled={saving} className="rounded-[10px] bg-blue px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Saving…" : "Save"}</button>
            </form>
            {stageError && <p role="alert" className="mt-3 text-sm text-[#B42318]">{stageError}</p>}
          </section>}

          {(wp.objective || wp.approach || wp.brief) && <section className="rounded-[20px] border border-[#EDEDF0] bg-white p-5">
            <h2 className="text-lg font-semibold text-[#101D37]">Brief</h2>
            <dl className="mt-4 grid gap-4">
              {[["Objective", wp.objective], ["Approach", wp.approach], ["Brief", wp.brief]].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="text-xs font-medium text-[#667085]">{label}</dt><dd className="mt-1 whitespace-pre-line text-sm text-[#344054]">{value}</dd></div>)}
            </dl>
          </section>}

          <section className="rounded-[20px] border border-[#EDEDF0] bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-[#101D37]">Research</h2>
              <button type="button" onClick={() => void startResearch()} disabled={starting || researching}
                className="rounded-[10px] bg-blue px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">{starting ? "Starting…" : researchLabel}</button>
            </div>
            <p className="mt-3 text-sm text-[#344054]">
              {research?.status ? `Status: ${research.status}` : "Research has not been run for this work package."}
            </p>
            {researchError && <p role="alert" className="mt-3 text-sm text-[#B42318]">{researchError}</p>}
            <Link href={`${V2}/projects/${projectId}/evidence?work_package=${taskId}`} className="mt-3 inline-block text-sm font-medium text-blue">Open evidence</Link>
          </section>

          <section className="rounded-[20px] border border-[#EDEDF0] bg-white p-5">
            <h2 className="text-lg font-semibold text-[#101D37]">Decision gates for this package</h2>
            {packageGates.length === 0 ? <p className="mt-4 text-sm text-[#667085]">No decision gate includes this work package.</p> : <ul className="mt-4 flex flex-col gap-3">
              {packageGates.map((gate) => <li key={gate.id} className="rounded-[14px] border border-[#EDEDF0] p-4">
                <p className="font-semibold text-[#101D37]">{gate.gate_name}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-md border border-[#EDEDF0] px-2 py-1 text-[#344054]">{dateLabel(gate.target_date ?? "")}</span>
                  <span className="rounded-md border border-[#EDEDF0] px-2 py-1 text-[#344054]">Approver: {gate.approver || "Not assigned"}</span>
                  <span className="rounded-md border border-[#EDEDF0] px-2 py-1 text-[#344054]">{gate.status}</span>
                </div>
              </li>)}
            </ul>}
          </section>

          <details className="rounded-[20px] border border-[#EDEDF0] bg-white p-5">
            <summary className="cursor-pointer text-lg font-semibold text-[#101D37]">From the project</summary>
            {inherited.length === 0 ? <p className="mt-4 text-sm text-[#667085]">The project has no shared details yet.</p> : <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              {inherited.map(([label, value]) => <div key={label}><dt className="text-xs font-medium text-[#667085]">{label}</dt><dd className="mt-1 whitespace-pre-line text-sm text-[#344054]">{value}</dd></div>)}
            </dl>}
          </details>
        </>}
      </main>
    </div>
  </div>;
}
