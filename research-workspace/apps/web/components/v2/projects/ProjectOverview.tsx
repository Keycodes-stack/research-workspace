"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import TopBar from "@/components/v2/dashboard/TopBar";
import ProjectsPanel from "@/components/v2/dashboard/ProjectsPanel";
import { useProjects } from "@/components/v2/V2Frame";
import AssessmentCard from "@/components/v2/projects/AssessmentCard";
import AttachmentGallery from "@/components/v2/projects/AttachmentGallery";
import NewWorkPackage from "@/components/v2/projects/NewWorkPackage";
import RefinementBar from "@/components/v2/projects/RefinementBar";
import { GATE_STATUSES, STATUS_CLS, Stat, charterOf, dateLabel, priorityChip, projectText } from "@/components/v2/projects/overviewShared";
import { api } from "@/lib/api";
import { asInsights } from "@/lib/projectIntake";
import { workPackage, type WorkPackage } from "@/lib/workPackages";
import type { DecisionGate, GateStatus, Project, TaskRow } from "@/lib/types";
import { V2 } from "@/lib/v2/routes";

export default function ProjectOverview({ id }: { id: string }) {
  const { projects, loading, error } = useProjects();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [tasksError, setTasksError] = useState("");
  const [sourceCount, setSourceCount] = useState<number | null>(null);
  const [signalCount, setSignalCount] = useState<number | null>(null);
  const [gates, setGates] = useState<DecisionGate[]>([]);
  const [gateError, setGateError] = useState("");
  const project: Project | undefined = projects.find((p) => p.id === id || p.slug === id);
  const [downloadError, setDownloadError] = useState("");
  const download = () => { setDownloadError(""); api.downloadProjectDocument(id).catch((e) => setDownloadError(e instanceof Error ? e.message : "Could not create the Word document.")); };

  // Source register counts per work package (papers selected, documents uploaded), shown in the table below.
  const [sourceCounts, setSourceCounts] = useState<Record<string, { papers: number; uploads: number }>>({});
  // Research status per work package, and the source counts. Failures leave the table working (dashes).
  const [runStatus, setRunStatus] = useState<Record<string, string>>({});
  const [researchError, setResearchError] = useState("");
  const loadRuns = async () => {
    try {
      const d = await api.projectEvidence(id);
      setSourceCounts(Object.fromEntries(d.runs.filter((r) => r.sources).map((r) => [r.task_id, r.sources!])));
      setRunStatus(Object.fromEntries(d.runs.map((r) => [r.task_id, r.status])));
    } catch {
      setSourceCounts({});
    }
  };
  useEffect(() => { void loadRuns(); }, [id, tasks]);
  const researching = Object.values(runStatus).some((s) => s === "queued" || s === "running");
  useEffect(() => {
    if (!researching) return;
    const timer = setInterval(() => void loadRuns(), 4000);
    return () => clearInterval(timer);
  }, [researching]);
  // Set from the click until the status refresh shows the run, so the button cannot be pressed twice.
  const [starting, setStarting] = useState<Record<string, boolean>>({});
  const startResearch = async (taskId: string) => {
    setResearchError("");
    setStarting((s) => ({ ...s, [taskId]: true }));
    try {
      await api.runTaskEvidence(taskId);
    } catch (e) {
      setResearchError(e instanceof Error ? e.message : "The research could not be started.");
    } finally {
      setStarting((s) => ({ ...s, [taskId]: false }));
    }
    await loadRuns();
  };
  const researchLabel = (status: string | undefined) =>
    status === "queued" || status === "running" ? "Researching…"
      : status === "complete" ? "Run again" : status === "failed" ? "Retry" : "Start research";

  // Old links opened a work package as ?work_package=<task id> on this page. That view now lives at its own route.
  useEffect(() => {
    const wp = new URLSearchParams(window.location.search).get("work_package");
    if (wp) window.location.replace(`${V2}/projects/${id}/work-packages/${wp}`);
  }, [id]);

  const reloadTasks = () => {
    api.tasks(id).then(setTasks).catch((e) => setTasksError(e instanceof Error ? e.message : "Could not load work packages."));
  };

  useEffect(() => {
    let live = true;
    api.tasks(id).then((rows) => { if (live) setTasks(rows); }).catch((e) => { if (live) setTasksError(e instanceof Error ? e.message : "Could not load work packages."); });
    api.sources(id).then((rows) => { if (live) setSourceCount(rows.length); }).catch(() => { if (live) setSourceCount(null); });
    api.signals(id).then((rows) => { if (live) setSignalCount(rows.length); }).catch(() => { if (live) setSignalCount(null); });
    api.projectGates(id).then((rows) => { if (live) setGates(rows); }).catch(() => { if (live) setGates([]); });
    return () => { live = false; };
  }, [id]);

  const changeGate = async (gateId: string, status: GateStatus) => {
    setGateError("");
    try {
      await api.setGateStatus(id, gateId, status);
      setGates(await api.projectGates(id));
    } catch (e) {
      setGateError(e instanceof Error ? e.message : "The gate status could not be saved.");
    }
  };

  const departments = Array.isArray(charterOf(project?.meta).departments)
    ? (charterOf(project?.meta).departments as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const text = (key: string) => projectText(project?.meta, key);
  const insights = asInsights(project?.meta?.insights);
  const packages: WorkPackage[] = tasks.map(workPackage);
  const priority = priorityChip(text("priority"));

  return <div className="flex min-w-0 flex-1">
    <ProjectsPanel activeId={id} showWorkPackages activeSection="overview" />
    <div className="flex min-w-0 flex-1 flex-col">
      <TopBar current="Overview" trail={[{ label: "Projects", href: `${V2}/projects` }]} />
      <main className="flex flex-col gap-5 px-4 pt-8 pb-16 sm:px-6 lg:px-10">
        {loading ? <p className="text-sm text-[#667085]">Loading project…</p> : error ? <p role="alert" className="text-sm text-[#B42318]">Could not load project: {error}</p> : !project ? <p className="text-sm text-[#667085]">Project not found.</p> : <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[#101D37] sm:text-3xl">{project.name}</h1>
              <p className="mt-1 text-sm text-[#667085]">{text("objective") || "Project overview."}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <button type="button" onClick={download} className="rounded-[10px] border border-[#EDEDF0] bg-white px-4 py-2.5 text-sm font-semibold text-[#101D37]">Download Word document</button>
              {downloadError && <p role="alert" className="text-xs text-[#B42318]">{downloadError}</p>}
            </div>
          </div>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat value={String(tasks.length)} label="Work Packages" />
            <Stat value={sourceCount === null ? "—" : String(sourceCount)} label="Sources" />
            <Stat value={signalCount === null ? "—" : String(signalCount)} label="Signals" />
            <Stat value={String(gates.length)} label="Decision Gates" />
          </section>

          <section className="rounded-[20px] border border-[#EDEDF0] bg-white p-5">
            <h2 className="text-lg font-semibold text-[#101D37]">Upcoming</h2>
            {gates.length === 0 ? <p className="mt-4 text-sm text-[#667085]">No decision gates yet.</p> : <ul className="mt-4 flex flex-col gap-3">
              {gates.map((gate) => <li key={gate.id} className="rounded-[14px] border border-[#EDEDF0] p-4">
                <p className="font-semibold text-[#101D37]">{gate.gate_name}</p>
                <p className="mt-0.5 text-sm text-[#667085]">{project.name}{gate.acceptance_criteria ? ` · ${gate.acceptance_criteria}` : ""}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-md border border-[#EDEDF0] px-2 py-1 text-[#344054]">{dateLabel(gate.target_date ?? "")}</span>
                  <span className="rounded-md border border-[#EDEDF0] px-2 py-1 text-[#344054]">Owner: {gate.decision_owner || "Not assigned"}</span>
                  <span className="rounded-md border border-[#EDEDF0] px-2 py-1 text-[#344054]">Approver: {gate.approver || "Not assigned"}</span>
                  <span className={`rounded-md px-2 py-1 font-medium ${priority.cls}`}>{priority.text}</span>
                  <label className="ml-auto flex items-center gap-2 text-[#344054]">Status
                    <select value={gate.status} onChange={(e) => void changeGate(gate.id, e.target.value as GateStatus)}
                      className="rounded-md border border-[#EDEDF0] bg-white px-2 py-1 text-xs text-[#101D37]">
                      {GATE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                </div>
              </li>)}
            </ul>}
            {gateError && <p role="alert" className="mt-3 text-sm text-[#B42318]">{gateError}</p>}
          </section>

          <section className="rounded-[20px] border border-[#EDEDF0] bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-[#101D37]">Work Packages</h2>
              <NewWorkPackage projectId={id} onCreated={reloadTasks} />
            </div>
            {tasksError ? <p role="alert" className="mt-4 text-sm text-[#B42318]">Could not load work packages: {tasksError}</p> : packages.length === 0 ? <p className="mt-4 text-sm text-[#667085]">No work packages yet.</p> : <table className="mt-4 w-full text-left text-sm">
              <thead><tr className="border-b border-[#EDEDF0] text-xs text-[#667085]"><th className="py-2 font-medium">Work Package</th><th className="py-2 font-medium">Responsible</th><th className="py-2 font-medium">Status</th><th className="py-2 font-medium">Sources</th><th className="py-2 font-medium">Research</th></tr></thead>
              <tbody>{packages.map((wp) => <tr key={wp.id} className="border-b border-[#EDEDF0] last:border-0">
                <td className="py-3"><Link href={`${V2}/projects/${id}/work-packages/${wp.id}`} className="font-medium text-[#101D37] hover:text-blue">{wp.title}</Link>{wp.output && <p className="mt-0.5 text-xs text-[#667085]">{project.name} · {wp.output}</p>}</td>
                <td className="py-3"><p className="text-[#344054]">{wp.owner}</p>{wp.department && <p className="mt-0.5 text-xs text-[#667085]">{wp.department}</p>}</td>
                <td className="py-3"><span className={`rounded-md px-2 py-1 text-xs font-medium ${STATUS_CLS[wp.status] ?? "bg-[#F2F4F7] text-[#475467]"}`}>{wp.status}</span></td>
                <td className="py-3 text-xs text-[#344054]">{sourceCounts[wp.id] ? `${sourceCounts[wp.id].papers} papers · ${sourceCounts[wp.id].uploads} uploads` : "—"}</td>
                <td className="py-3">
                  <button type="button" onClick={() => void startResearch(wp.id)}
                    disabled={starting[wp.id] || runStatus[wp.id] === "queued" || runStatus[wp.id] === "running"}
                    className="rounded-[10px] bg-blue px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">{starting[wp.id] ? "Starting…" : researchLabel(runStatus[wp.id])}</button>
                </td>
              </tr>)}</tbody>
            </table>}{researchError && <p role="alert" className="mt-3 text-sm text-[#B42318]">{researchError}</p>}
          </section>

          <AttachmentGallery projectId={id} />
          <section className="rounded-[20px] border border-[#EDEDF0] bg-white p-5"><h2 className="text-lg font-semibold text-[#101D37]">Project charter</h2><dl className="mt-4 grid gap-4 sm:grid-cols-2">
            {[ ["Project type", text("type")], ["Sponsor", text("sponsor")], ["Governance", text("governance")], ["Target completion", text("target")], ["Departments", departments.join(", ")], ["Deliverable", text("deliverable")], ["In scope", text("in_scope")], ["Out of scope", text("out_scope")] ].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="text-xs font-medium text-[#667085]">{label}</dt><dd className="mt-1 whitespace-pre-line text-sm text-[#344054]">{value}</dd></div>)}
          </dl></section>
          {insights && <AssessmentCard insights={insights} />}
        </>}
        <RefinementBar projectId={id} onApplied={reloadTasks} />
      </main>
    </div>
  </div>;
}
