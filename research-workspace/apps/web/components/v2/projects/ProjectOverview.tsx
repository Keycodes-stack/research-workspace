"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import TopBar from "@/components/v2/dashboard/TopBar";
import ProjectsPanel from "@/components/v2/dashboard/ProjectsPanel";
import { useProjects } from "@/components/v2/V2Frame";
import AssessmentCard from "@/components/v2/projects/AssessmentCard";
import { api } from "@/lib/api";
import { asInsights } from "@/lib/projectIntake";
import type { Project, TaskRow } from "@/lib/types";
import { V2 } from "@/lib/v2/routes";

export default function ProjectOverview({ id }: { id: string }) {
  const { projects, loading, error } = useProjects();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [tasksError, setTasksError] = useState("");
  const project: Project | undefined = projects.find((p) => p.id === id);
  useEffect(() => {
    let live = true;
    api.tasks(id).then((rows) => { if (live) setTasks(rows); }).catch((e) => { if (live) setTasksError(e instanceof Error ? e.message : "Could not load work packages."); });
    return () => { live = false; };
  }, [id]);

  const charter = project?.meta?.charter && typeof project.meta.charter === "object"
    ? project.meta.charter as Record<string, unknown> : {};
  const departments = Array.isArray(charter.departments) ? charter.departments.filter((x): x is string => typeof x === "string") : [];
  const text = (key: string) => typeof charter[key] === "string" ? charter[key] as string : typeof project?.meta?.[key] === "string" ? project.meta[key] as string : "";
  const insights = asInsights(project?.meta?.insights);

  return <div className="flex min-w-0 flex-1">
    <ProjectsPanel activeId={id} showWorkPackages activeSection="overview" />
    <div className="flex min-w-0 flex-1 flex-col">
      <TopBar current="Overview" trail={[{ label: "Projects", href: `${V2}/projects` }]} />
      <main className="flex flex-col gap-5 px-4 pt-8 pb-16 sm:px-6 lg:px-10">
        {loading ? <p className="text-sm text-[#667085]">Loading project…</p> : error ? <p role="alert" className="text-sm text-[#B42318]">Could not load project: {error}</p> : !project ? <p className="text-sm text-[#667085]">Project not found.</p> : <>
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold text-[#101D37] sm:text-3xl">{project.name}</h1><p className="mt-1 text-sm text-[#667085]">{text("objective") || "Project overview and draft research packages."}</p></div><Link href={`${V2}/projects/new`} className="rounded-[10px] bg-blue px-4 py-2.5 text-sm font-semibold text-white">+ New Project</Link></div>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[{ label: "Research packages", value: String(tasks.length) }, { label: "Project lead", value: text("lead") || "Not assigned" }, { label: "Priority", value: text("priority") || "Not set" }, { label: "Research mode", value: project.mode === "open_discovery" ? "Open discovery" : "Closed repository" }].map((stat) => <div key={stat.label} className="rounded-[14px] border border-[#EDEDF0] bg-white p-4"><p className="text-xs text-[#667085]">{stat.label}</p><p className="mt-1 truncate text-base font-semibold text-[#101D37]">{stat.value}</p></div>)}
          </section>
          <section className="rounded-[20px] border border-[#EDEDF0] bg-white p-5"><h2 className="text-lg font-semibold text-[#101D37]">Project charter</h2><dl className="mt-4 grid gap-4 sm:grid-cols-2">
            {[ ["Project type", text("type")], ["Sponsor", text("sponsor")], ["Governance", text("governance")], ["Target completion", text("target")], ["Departments", departments.join(", ")], ["Deliverable", text("deliverable")], ["In scope", text("in_scope")], ["Out of scope", text("out_scope")] ].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="text-xs font-medium text-[#667085]">{label}</dt><dd className="mt-1 whitespace-pre-line text-sm text-[#344054]">{value}</dd></div>)}
          </dl></section>
          {insights && <AssessmentCard insights={insights} />}
          <section className="rounded-[20px] border border-[#EDEDF0] bg-white p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-[#101D37]">Work packages</h2><p className="mt-1 text-sm text-[#667085]">Draft tasks created from the reviewed workstreams.</p></div><Link href={`${V2}/projects/new`} className="text-sm font-semibold text-blue">Create another project</Link></div>
            {tasksError ? <p role="alert" className="mt-4 text-sm text-[#B42318]">Could not load work packages: {tasksError}</p> : tasks.length === 0 ? <p className="mt-4 text-sm text-[#667085]">No research packages yet.</p> : <ul className="mt-4 divide-y divide-[#EDEDF0]">{tasks.map((task) => <li key={task.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="text-sm font-medium text-[#101D37]">{task.title}</p><p className="mt-0.5 text-xs text-[#667085]">{task.status === "draft" ? "Draft · add and approve sources before research" : task.status}</p></div><span className="rounded-full bg-[#F2F4F7] px-2.5 py-1 text-xs font-medium text-[#475467]">{task.status}</span></li>)}</ul>}
          </section>
        </>}
      </main>
    </div>
  </div>;
}
