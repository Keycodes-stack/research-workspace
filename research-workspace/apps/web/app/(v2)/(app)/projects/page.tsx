"use client";

import Link from "next/link";
import { useState } from "react";
import { Folder } from "@untitledui/icons";
import { Add01Icon } from "@hugeicons/core-free-icons";
import Icon, { huge, untitled } from "@/components/v2/dashboard/Icon";
import TopBar from "@/components/v2/dashboard/TopBar";
import ProjectsPanel from "@/components/v2/dashboard/ProjectsPanel";
import { useProjects } from "@/components/v2/V2Frame";
import type { Project } from "@/lib/types";
import { V2, projectHref } from "@/lib/v2/routes";

/*
 * Design: the reference Projects directory (Projects Research Initiatives): Projects (name and code), Lead,
 * Work Package (count), Stage (progress with its percentage) and Status.
 * Data: GET /projects. Progress is the average progress of the project's work packages; "—" until it has any.
 */
const NO_DATA = "—";
const STATUSES = ["All", "Active", "In Progress", "Pending Approval", "Completed", "Parked"] as const;
const ROW_GRID = "grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_120px_minmax(0,1.1fr)_150px] items-center gap-4";

/** Status colours follow the reference: In Progress warm, Pending blue, Active and Completed green. */
const STATUS_CLS: Record<string, string> = {
  Active: "bg-[#ECFDF3] text-[#067647]",
  "In Progress": "bg-[#FEF0EA] text-[#B93815]",
  Pending: "bg-[#EEF4FF] text-[#3538CD]",
  "Pending Approval": "bg-[#FFFAEB] text-[#B54708]",
  Completed: "bg-[#ECFDF3] text-[#067647]",
  Parked: "bg-[#F2F4F7] text-[#475467]",
};

function StatusPill({ status }: { status?: string }) {
  const label = status || NO_DATA;
  return <span className={`inline-flex w-fit rounded-md px-2.5 py-1 text-xs font-medium ${STATUS_CLS[label] ?? "bg-[#F2F4F7] text-[#475467]"}`}>{label}</span>;
}

/** Short progress track with a round knob showing the percentage, as in the reference. Red at 0%. */
function StageProgress({ value }: { value?: number | null }) {
  if (value == null) return <span className="text-sm text-[#242C2C]">{NO_DATA}</span>;
  const colour = value === 0 ? "#D92D20" : "#F97316";
  return <div className="flex h-6 w-[100px] items-center" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
    <div className="relative h-1 w-full rounded-full bg-[#EDEDF0]">
      <div className="absolute left-0 top-0 h-full rounded-full" style={{ width: `${value}%`, background: colour }} />
      <span className="absolute top-1/2 flex size-[22px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[9px] font-semibold text-white"
        style={{ left: `${value}%`, background: colour }}>{value}%</span>
    </div>
  </div>;
}

export default function ProjectsPage() {
  const { projects, loading, error, reload } = useProjects();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("All");
  const [showFilter, setShowFilter] = useState(false);

  const lead = (p: Project) => (p.project_lead?.trim() || (typeof p.meta?.lead === "string" ? p.meta.lead.trim() : "")) || NO_DATA;
  const shown = projects.filter((p) => {
    const text = `${p.name} ${p.code ?? ""} ${lead(p)}`.toLowerCase();
    return text.includes(query.trim().toLowerCase()) && (status === "All" || (p.status ?? "Active") === status);
  }).sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")); // newest first

  return (
    <div className="flex min-w-0 flex-1">
      <ProjectsPanel />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar current="Projects" />

        <main className="flex flex-col gap-5 px-4 pt-10 pb-16 sm:px-6 lg:px-10">
          <h1 className="text-2xl leading-[1.2] font-semibold tracking-[-0.02em] text-[#101D37] sm:text-[30px]">Projects</h1>

          <section className="flex w-full flex-col gap-4 rounded-[20px] border border-[#EDEDF0] bg-white p-5">
            <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-[#101D37] sm:text-xl">Projects Research Initiatives</h2>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setShowFilter((v) => !v)} aria-expanded={showFilter}
                  className="flex h-9 items-center gap-1 rounded-[10px] border border-[#EDEDF0] px-3 py-2 text-sm font-semibold text-[#242C2C]">Filter</button>
                <Link href={`${V2}/projects/new`} className="flex h-9 items-center gap-1.5 rounded-[10px] bg-blue px-3 py-2 text-sm font-semibold text-white">
                  <Icon icon={huge(Add01Icon)} size={16} />
                  Add New Project
                </Link>
              </div>
            </div>

            {showFilter && <div className="flex flex-wrap items-center gap-3">
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a project by title, code, or lead..."
                aria-label="Find a project" className="h-9 min-w-[220px] flex-1 rounded-[10px] border border-[#EDEDF0] bg-white px-3 text-sm text-[#101D37] outline-none focus:border-blue" />
              <label className="flex items-center gap-2 text-sm text-[#344054]">Status
                <select value={status} onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])} aria-label="Status filter"
                  className="h-9 rounded-[10px] border border-[#EDEDF0] bg-white px-2 text-sm text-[#101D37] outline-none focus:border-blue">
                  {STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
            </div>}


            {error ? (
              <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-body">
                <span>Could not load projects: {error}</span>
                <button type="button" onClick={() => void reload()} className="font-semibold text-blue">Try again</button>
              </div>
            ) : loading ? (
              <p className="mt-1 text-sm text-body">Loading projects…</p>
            ) : projects.length === 0 ? (
              <p className="mt-1 text-sm text-body">No projects yet. Use Add New Project to start one.</p>
            ) : shown.length === 0 ? (
              <p className="mt-1 text-sm text-body">No project matches this search or status.</p>
            ) : (
              <>
                {/* Small screens: stacked cards with the same five fields */}
                <ul className="flex flex-col gap-2 md:hidden">
                  {shown.map((p) => (
                    <li key={p.id} className="flex flex-col gap-3 rounded-[7.88px] border border-[#EDEDF0] bg-[#FAFAFA] p-4">
                      <Link href={projectHref(p)} className="flex flex-col gap-1">
                        <span className="text-sm font-semibold text-[#242C2C]">{p.name}</span>
                        <span className="text-xs text-body">{p.code ?? NO_DATA} · Lead: {lead(p)} · WP: {p.work_packages ?? NO_DATA}</span>
                      </Link>
                      <StageProgress value={p.progress} />
                      <div className="flex items-center justify-between gap-2">
                        <StatusPill status={p.status} />
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="-mx-5 hidden overflow-x-auto px-5 md:block">
                  <div className="flex min-w-[860px] flex-col gap-3">
                    <div className={`${ROW_GRID} px-4 text-sm font-semibold text-[#101D37]`}>
                      <span>Projects</span><span>Lead</span><span>Work Package</span><span>Stage</span><span>Status</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {shown.map((p) => (
                        <div key={p.id} className={`${ROW_GRID} min-h-[59px] rounded-[7.88px] border border-[#EDEDF0] bg-[#FAFAFA] px-4 py-2.5 transition-colors hover:border-[#D7DBE3]`}>
                          <Link href={projectHref(p)} className="flex min-w-0 items-center gap-3">
                            <Icon icon={untitled(Folder)} size={20} className="shrink-0 text-[#242C2C]" />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-[#242C2C]">{p.name}</p>
                              <p className="text-xs text-body">{p.code ?? NO_DATA}</p>
                            </div>
                          </Link>
                          <span className="truncate text-sm text-[#242C2C]">{lead(p)}</span>
                          <span className="text-sm text-[#242C2C]">{p.work_packages ?? NO_DATA}</span>
                          <StageProgress value={p.progress} />
                          <div className="flex flex-col items-start gap-1">
                            <StatusPill status={p.status} />
                          </div>
                        </div>
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
