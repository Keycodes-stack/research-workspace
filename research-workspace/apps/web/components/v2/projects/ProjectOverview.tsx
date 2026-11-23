"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import TopBar from "@/components/v2/dashboard/TopBar";
import ProjectsPanel from "@/components/v2/dashboard/ProjectsPanel";
import { useProjects } from "@/components/v2/V2Frame";
import AssessmentCard from "@/components/v2/projects/AssessmentCard";
import AttachmentGallery from "@/components/v2/projects/AttachmentGallery";
import { api } from "@/lib/api";
import { asInsights } from "@/lib/projectIntake";
import { workPackage, type WorkPackage } from "@/lib/workPackages";
import type { Project, TaskRow } from "@/lib/types";
import { V2 } from "@/lib/v2/routes";

type Gate = { name?: string; owner?: string; approver?: string; date?: string; criteria?: string };

const dateLabel = (iso: string) =>
  iso ? new Date(`${iso}T00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "No date";

/** Priority chip colours follow the reference: high red, low green, otherwise amber. */
function priorityChip(priority: string) {
  if (/urgent|high/i.test(priority)) return { text: "High Priority", cls: "bg-[#FEF3F2] text-[#B42318]" };
  if (/low/i.test(priority)) return { text: "Low Priority", cls: "bg-[#ECFDF3] text-[#067647]" };
  return { text: "Medium Priority", cls: "bg-[#FFFAEB] text-[#B54708]" };
}

const STATUS_CLS: Record<string, string> = {
  Pending: "bg-[#F2F4F7] text-[#475467]",
  "In Progress": "bg-[#EFF4FF] text-blue",
  Complete: "bg-[#ECFDF3] text-[#067647]",
  Failed: "bg-[#FEF3F2] text-[#B42318]",
};

function Stat({ value, label }: { value: string; label: string }) {
  return <div className="flex flex-col gap-1 rounded-[14px] border border-[#EDEDF0] bg-white p-5">
    <span className="text-2xl font-semibold text-blue">{value}</span>
    <span className="text-sm font-medium text-[#101D37]">{label}</span>
  </div>;
}

export default function ProjectOverview({ id }: { id: string }) {
  const { projects, loading, error } = useProjects();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [tasksError, setTasksError] = useState("");
  const [sourceCount, setSourceCount] = useState<number | null>(null);
  const [signalCount, setSignalCount] = useState<number | null>(null);
  const project: Project | undefined = projects.find((p) => p.id === id || p.slug === id);
  const [downloadError, setDownloadError] = useState("");
  const download = () => { setDownloadError(""); api.downloadProjectDocument(id).catch((e) => setDownloadError(e instanceof Error ? e.message : "Could not create the Word document.")); };

  useEffect(() => {
    let live = true;
    api.tasks(id).then((rows) => { if (live) setTasks(rows); }).catch((e) => { if (live) setTasksError(e instanceof Error ? e.message : "Could not load work packages."); });
    api.sources(id).then((rows) => { if (live) setSourceCount(rows.length); }).catch(() => { if (live) setSourceCount(null); });
    api.signals(id).then((rows) => { if (live) setSignalCount(rows.length); }).catch(() => { if (live) setSignalCount(null); });
    return () => { live = false; };
  }, [id]);

  const charter = project?.meta?.charter && typeof project.meta.charter === "object"
    ? project.meta.charter as Record<string, unknown> : {};
  const departments = Array.isArray(charter.departments) ? charter.departments.filter((x): x is string => typeof x === "string") : [];
  const text = (key: string) => typeof charter[key] === "string" ? charter[key] as string : typeof project?.meta?.[key] === "string" ? project.meta[key] as string : "";
  const insights = asInsights(project?.meta?.insights);
  const gates = (Array.isArray(charter.gates) ? charter.gates as Gate[] : [])
    .filter((g) => g.name?.trim())
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
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
              {gates.map((gate, i) => <li key={`${gate.name}-${i}`} className="rounded-[14px] border border-[#EDEDF0] p-4">
                <p className="font-semibold text-[#101D37]">{gate.name}</p>
                <p className="mt-0.5 text-sm text-[#667085]">{project.name}{gate.criteria ? ` · ${gate.criteria}` : ""}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-md border border-[#EDEDF0] px-2 py-1 text-[#344054]">{dateLabel(gate.date ?? "")}</span>
                  <span className="rounded-md border border-[#EDEDF0] px-2 py-1 text-[#344054]">Owner: {gate.owner || "Not assigned"}</span>
                  <span className="rounded-md border border-[#EDEDF0] px-2 py-1 text-[#344054]">Approver: {gate.approver || "Not assigned"}</span>
                  <span className={`rounded-md px-2 py-1 font-medium ${priority.cls}`}>{priority.text}</span>
                </div>
              </li>)}
            </ul>}
          </section>

          <section className="rounded-[20px] border border-[#EDEDF0] bg-white p-5">
            <h2 className="text-lg font-semibold text-[#101D37]">Work Packages</h2>
            {tasksError ? <p role="alert" className="mt-4 text-sm text-[#B42318]">Could not load work packages: {tasksError}</p> : packages.length === 0 ? <p className="mt-4 text-sm text-[#667085]">No work packages yet.</p> : <table className="mt-4 w-full text-left text-sm">
              <thead><tr className="border-b border-[#EDEDF0] text-xs text-[#667085]"><th className="py-2 font-medium">Work Package</th><th className="py-2 font-medium">Responsible</th><th className="py-2 font-medium">Status</th></tr></thead>
              <tbody>{packages.map((wp) => <tr key={wp.id} className="border-b border-[#EDEDF0] last:border-0">
                <td className="py-3"><Link href={`${V2}/projects/${id}/workspace/${wp.id}`} className="font-medium text-[#101D37] hover:text-blue">{wp.title}</Link>{wp.output && <p className="mt-0.5 text-xs text-[#667085]">{project.name} · {wp.output}</p>}</td>
                <td className="py-3"><p className="text-[#344054]">{wp.owner}</p>{wp.department && <p className="mt-0.5 text-xs text-[#667085]">{wp.department}</p>}</td>
                <td className="py-3"><span className={`rounded-md px-2 py-1 text-xs font-medium ${STATUS_CLS[wp.status] ?? "bg-[#F2F4F7] text-[#475467]"}`}>{wp.status}</span></td>
              </tr>)}</tbody>
            </table>}
          </section>

          <AttachmentGallery projectId={id} />
          <section className="rounded-[20px] border border-[#EDEDF0] bg-white p-5"><h2 className="text-lg font-semibold text-[#101D37]">Project charter</h2><dl className="mt-4 grid gap-4 sm:grid-cols-2">
            {[ ["Project type", text("type")], ["Sponsor", text("sponsor")], ["Governance", text("governance")], ["Target completion", text("target")], ["Departments", departments.join(", ")], ["Deliverable", text("deliverable")], ["In scope", text("in_scope")], ["Out of scope", text("out_scope")] ].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="text-xs font-medium text-[#667085]">{label}</dt><dd className="mt-1 whitespace-pre-line text-sm text-[#344054]">{value}</dd></div>)}
          </dl></section>
          {insights && <AssessmentCard insights={insights} />}
        </>}
      </main>
    </div>
  </div>;
}
