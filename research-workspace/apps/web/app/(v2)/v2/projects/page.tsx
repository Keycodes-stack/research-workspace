"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FilterLines, Folder } from "@untitledui/icons";
import { Add01Icon } from "@hugeicons/core-free-icons";
import Icon, { huge, untitled } from "@/components/v2/dashboard/Icon";
import TopBar from "@/components/v2/dashboard/TopBar";
import ProjectsPanel from "@/components/v2/dashboard/ProjectsPanel";
import { useProjects } from "@/components/v2/V2Frame";
import { api } from "@/lib/api";
import type { Project } from "@/lib/types";
import { V2 } from "@/lib/v2/routes";

/*
 * Design: app/(dashboard)/projects/page.tsx. Real projects from GET /projects.
 * Work Package = the project's research tasks (GET /projects/{id}/tasks, one request per project).
 * Code, Stage and Status have no backend data yet: "—" (see placeholder.md).
 */
const ROW_GRID = "grid grid-cols-[minmax(0,1fr)_136.12px_124px_134.82px_83px] items-center";
const HEAD_GRID = "grid grid-cols-[minmax(0,1fr)_136.12px_124px_134.82px_101.2px] items-center";
const NO_DATA = "—";
const cell = "text-sm leading-[1.5] tracking-[-0.02em] text-[#242C2C]";

/** Research-task count per project; a project whose count fails to load shows "—". */
function useTaskCounts(projects: Project[]) {
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  useEffect(() => {
    let live = true;
    for (const p of projects) {
      api.tasks(p.id)
        .then((tasks) => { if (live) setCounts((c) => ({ ...c, [p.id]: tasks.length })); })
        .catch(() => { if (live) setCounts((c) => ({ ...c, [p.id]: null })); });
    }
    return () => { live = false; };
  }, [projects]);
  return (id: string) => (counts[id] == null ? NO_DATA : String(counts[id]));
}

export default function ProjectsPage() {
  const { projects, loading, error, reload } = useProjects();
  const workPackages = useTaskCounts(projects);
  const lead = (p: Project) => typeof p.meta?.lead === "string" ? p.meta.lead.trim() || NO_DATA : NO_DATA;

  return (
    <div className="flex min-w-0 flex-1">
      <ProjectsPanel />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar current="Projects" />

        <main className="flex flex-col gap-5 px-4 pt-10 pb-16 sm:px-6 lg:px-10">
          <h1 className="text-2xl leading-[1.2] font-semibold tracking-[-0.02em] text-[#101D37] sm:text-[30px]">
            Projects
          </h1>

          <section className="flex w-full flex-col gap-[6.06px] rounded-[20px] border border-[#EDEDF0] bg-white p-5">
            <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg leading-[1.5] font-semibold tracking-[-0.02em] text-[#101D37] sm:text-xl">
                Projects Research Initiatives
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="flex h-9 items-center gap-1 rounded-[10px] border border-[#EDEDF0] px-3 py-2 text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[#242C2C]"
                >
                  <Icon icon={untitled(FilterLines)} size={16} />
                  Filter
                </button>
                <Link
                  href={`${V2}/projects/new`}
                  className="flex h-9 items-center gap-1.5 rounded-[10px] bg-blue px-3 py-2 text-sm leading-5 font-semibold tracking-[-0.02em] text-white"
                >
                  <Icon icon={huge(Add01Icon)} size={16} />
                  Add New Project
                </Link>
              </div>
            </div>

            {error ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-body">
                <span>Could not load projects: {error}</span>
                <button type="button" onClick={() => void reload()} className="font-semibold text-blue">Try again</button>
              </div>
            ) : loading ? (
              <p className="mt-3 text-sm text-body">Loading projects…</p>
            ) : projects.length === 0 ? (
              <p className="mt-3 text-sm text-body">No projects yet. Use Add New Project to start one.</p>
            ) : (
              <>
                {/* Mobile: stacked cards */}
                <ul className="mt-3 flex flex-col gap-2 md:hidden">
                  {projects.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`${V2}/projects/${p.id}`}
                        className="flex flex-col gap-3 rounded-[7.88px] border border-[#EDEDF0] bg-[#FAFAFA] p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <Icon icon={untitled(Folder)} size={20} className="shrink-0 text-[#242C2C]" />
                            <div className="min-w-0">
                              <p className="text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[#242C2C]">{p.name}</p>
                              <p className="text-xs leading-[1.5] tracking-[-0.02em] text-body">{NO_DATA}</p>
                            </div>
                          </div>
                          <span className={cell}>{NO_DATA}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-xs leading-[1.5] tracking-[-0.02em] text-body">
                          <span className="whitespace-nowrap">Lead: <span className="text-[#242C2C]">{lead(p)}</span></span>
                          <span className="whitespace-nowrap">WP: <span className="text-[#242C2C]">{workPackages(p.id)}</span></span>
                          <span className="text-[#242C2C]">{NO_DATA}</span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>

                <div className="-mx-5 hidden overflow-x-auto px-5 md:block">
                  <div className="flex min-w-[640px] flex-col gap-5 pt-[13.94px]">
                    <div className={`${HEAD_GRID} text-sm leading-[1.2] font-semibold tracking-[-0.02em] text-[#101D37]`}>
                      <span className="pl-[15.37px]">Projects</span>
                      <span>Lead</span>
                      <span>Work Package</span>
                      <span>Stage</span>
                      <span>Status</span>
                    </div>

                    <div className="flex flex-col gap-2">
                      {projects.map((p) => (
                        <Link
                          key={p.id}
                          href={`${V2}/projects/${p.id}`}
                          className={`${ROW_GRID} min-h-[59px] rounded-[7.88px] border border-[#EDEDF0] bg-[#FAFAFA] px-[18.18px] py-2.5 transition-colors hover:border-[#D7DBE3]`}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <Icon icon={untitled(Folder)} size={20} className="shrink-0 text-[#242C2C]" />
                            <div className="min-w-0">
                              <p className="truncate text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[#242C2C]">{p.name}</p>
                              <p className="text-xs leading-[1.5] tracking-[-0.02em] text-body">{NO_DATA}</p>
                            </div>
                          </div>
                          <span className={cell}>{lead(p)}</span>
                          <span className={cell}>{workPackages(p.id)}</span>
                          <span className={cell}>{NO_DATA}</span>
                          <span className={cell}>{NO_DATA}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
