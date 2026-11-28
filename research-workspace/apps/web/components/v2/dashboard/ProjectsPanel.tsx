"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Folder } from "@untitledui/icons";
import {
  Add01Icon,
  BubbleChatIcon,
  CheckmarkBadge01Icon,
  Search01Icon,
  UserGroupIcon,
  WorkflowSquare03Icon,
} from "@hugeicons/core-free-icons";
import Icon, { huge, untitled } from "./Icon";
import { api } from "@/lib/api";
import { useProjects } from "../V2Frame";
import { V2, projectHref } from "@/lib/v2/routes";

/**
 * Figma "Group 3": secondary panel, 215 wide, white, right border #EDEDF0.
 *  - "Total Projects" Inter 600 16 #101D37 + count #285CE0, top 20
 *  - search 183 x 40, radius 6, #FAFAFA, top 82
 *  - project list (Inter 12, #667085, gap 10 + divider lines) at top 147; active item 600 #101D37
 *  - "+ New …" link Inter 500 12 #285CE0
 *  - Overview frame only: "Work Packages" section (Inter 600 16) with sub items
 * Real projects (GET /projects) and the active project's real work packages (GET /projects/{id}/tasks).
 */
const WP_SECTIONS = [
  { key: "overview", label: "Overview" },
  { key: "workspace", label: "Workspace" },
  { key: "evidence", label: "Evidence" },
  /* Findings, Reviews & Decisions and Reports are hidden until those screens exist */
] as const;

/** project-level screens (Departments, Baseline, Teams, Chats) */
export type ProjectPage = "departments" | "baseline" | "teams" | "chats";
const PROJECT_PAGES: { key: ProjectPage; label: string; icon: typeof Add01Icon }[] = [
  { key: "departments", label: "Departments & Workstreams", icon: WorkflowSquare03Icon },
  { key: "baseline", label: "Baseline & Approvals", icon: CheckmarkBadge01Icon },
  { key: "teams", label: "Project Teams", icon: UserGroupIcon },
  { key: "chats", label: "Project Chats", icon: BubbleChatIcon },
];

/* The sidebar reads the open work package from the URL, so it survives page changes (Overview, Evidence, Workspace).
   useSearchParams needs a Suspense boundary in Next.js; the wrapper provides it once for every page. */
export default function ProjectsPanel(props: Parameters<typeof ProjectsPanelInner>[0]) {
  return (
    <Suspense fallback={null}>
      <ProjectsPanelInner {...props} />
    </Suspense>
  );
}

function ProjectsPanelInner({
  activeId,
  newLabel = "New Research Study",
  showWorkPackages = false,
  activeSection,
  activePage,
}: {
  activeId?: string;
  newLabel?: string;
  showWorkPackages?: boolean;
  /** Workspace frame: expands "Storage Technology" with its sections */
  activeSection?: "overview" | "workspace" | "evidence";
  activePage?: ProjectPage;
}) {
  const [query, setQuery] = useState("");
  const [packages, setPackages] = useState<{ id: string; title: string }[]>([]);
  // The work package whose sections are shown: the one named in the URL (Overview/Evidence links carry it), else the
  // one whose Workspace is open, else the work package this route is about (/work-packages/<id>), else the first.
  // Only packages of this project count.
  const pathname = usePathname();
  const params = useSearchParams();
  const routeWp = pathname.match(/\/(?:workspace|work-packages)\/([^/]+)/)?.[1] ?? null;
  const expandedWp = [params.get("work_package"), routeWp]
    .find((id) => !!id && packages.some((p) => p.id === id)) ?? packages[0]?.id ?? null;
  // The shared projects list starts empty while it loads: showing 0 until then is a false count, so show "—".
  const { projects: all, loading: projectsLoading } = useProjects();
  useEffect(() => {
    if (!showWorkPackages || !activeId) return;
    let live = true;
    api.tasks(activeId).then((rows) => { if (live) setPackages(rows.map((t) => ({ id: t.id, title: t.title }))); }).catch(() => { if (live) setPackages([]); });
    return () => { live = false; };
  }, [activeId, showWorkPackages]);
  const list = all.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <aside className="sticky top-0 hidden h-dvh w-[215px] shrink-0 min-[1600px]:w-[260px] flex-col overflow-x-hidden overflow-y-auto border-r border-[#EDEDF0] bg-white px-4 xl:flex">
      <div className="flex h-16 shrink-0 items-start justify-between pt-5">
        <h2 className="text-base leading-[1.5] font-semibold tracking-[-0.02em] text-[#101D37]">
          Total Projects
        </h2>
        <span className="pr-0.5 text-base leading-[1.5] font-semibold tracking-[-0.02em] text-blue">
          {projectsLoading ? "—" : all.length}
        </span>
      </div>

      <label className="mt-[18px] flex h-10 w-[183px] shrink-0 items-center gap-2 rounded-md border border-[#EDEDF0] bg-[#FAFAFA] px-3 py-2.5">
        <Icon icon={huge(Search01Icon)} size={14} stroke={1.2} className="shrink-0 text-[#101D37]" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a project"
          className="w-full min-w-0 bg-transparent text-xs leading-[1.5] tracking-[-0.02em] text-[#101D37] outline-none placeholder:text-body"
        />
      </label>

      {/* Figma Frame 2147232135: top 147, 186 wide, gap 10, 1px #EDEDF0 line between items */}
      <ul className="mt-[25px] flex w-[186px] flex-col gap-[10px]">
        {projectsLoading && list.length === 0 && (
          <li className="text-xs leading-[1.5] tracking-[-0.02em] text-body">Loading projects…</li>
        )}
        {list.map((p, i) => {
          const active = p.id === activeId || p.slug === activeId;
          return (
            <li key={p.id} className="flex flex-col gap-[10px]">
              {i > 0 && <div className="h-px w-full bg-[#EDEDF0]" />}
              <Link
                href={projectHref(p)}
                className={`flex items-center gap-2 text-xs leading-[1.5] tracking-[-0.02em] hover:text-[#101D37] ${
                  active ? "font-semibold text-[#101D37]" : "text-body"
                }`}
              >
                <Icon icon={untitled(Folder)} size={13} stroke={1.1} className="shrink-0" />
                <span className="truncate">{p.name}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <Link
        href={`${V2}/projects/new`}
        className="mt-[17px] flex items-center gap-2 text-xs leading-[1.5] font-medium tracking-[-0.02em] text-blue"
      >
        <Icon icon={huge(Add01Icon)} size={13} stroke={1.1} />
        {newLabel}
      </Link>

      {showWorkPackages && (
        <div className="mt-5 -mx-4 flex flex-col border-t border-[#EDEDF0] px-4 pt-5 pb-6">
          <h3 className="text-base leading-[1.5] font-semibold tracking-[-0.02em] text-[#101D37]">
            Work Packages
          </h3>
          <ul className="mt-5 flex w-[186px] flex-col gap-[10px]">
            {packages.map((wp, i) => (
              <li key={wp.id} className="flex flex-col gap-[10px]">
                {i > 0 && <div className="h-px w-full bg-[#EDEDF0]" />}
                <Link
                  href={activeId ? `${V2}/projects/${activeId}/workspace/${wp.id}` : "#"}
                  className="flex items-center gap-2 text-xs leading-[1.5] tracking-[-0.02em] text-body hover:text-[#101D37]"
                >
                  <Icon icon={untitled(Folder)} size={13} stroke={1.1} className="shrink-0" />
                  <span className="truncate">{wp.title}</span>
                </Link>
                {/* Figma Frame 2147232168: 164 wide at x 298, gap 10, dividers */}
                {wp.id === expandedWp && activeSection && activeId && (
                  <ul className="mt-[10px] ml-[22px] flex w-[164px] flex-col gap-[10px]">
                    {WP_SECTIONS.map((sec, j) => {
                      const href =
                        sec.key === "overview"
                          ? `${V2}/projects/${activeId}/work-packages/${wp.id}`
                          : sec.key === "workspace" && wp.id
                              ? `${V2}/projects/${activeId}/workspace/${wp.id}`
                              : sec.key === "evidence"
                            ? `${V2}/projects/${activeId}/${sec.key}?work_package=${wp.id}`
                            : "#";
                      const on = sec.key === activeSection;
                      return (
                        <li key={sec.key} className="flex flex-col gap-[10px]">
                          {j > 0 && <div className="h-px w-full bg-[#EDEDF0]" />}
                          <Link
                            href={href}
                            className={`text-xs leading-[1.5] tracking-[-0.02em] hover:text-[#101D37] ${
                              on ? "font-semibold text-[#101D37]" : "text-body"
                            }`}
                          >
                            {sec.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          <Link
            href={`${V2}/projects/new`}
            className="mt-[17px] flex items-center gap-2 text-xs leading-[1.5] font-medium tracking-[-0.02em] text-blue"
          >
            <Icon icon={huge(Add01Icon)} size={13} stroke={1.1} />
            New Research Study
          </Link>
          <Link
            href={activeId ? `${V2}/projects/${activeId}/timeline` : "#"}
            className="mt-[14px] flex items-center gap-2 text-xs leading-[1.5] font-medium tracking-[-0.02em] text-body hover:text-[#101D37]"
          >
            <Icon icon={huge(UserGroupIcon)} size={13} stroke={1.1} />
            Teams &amp; Timeline
          </Link>
        </div>
      )}

      {activeId && (
        <nav aria-label="Project" className="-mx-4 flex flex-col border-t border-[#EDEDF0] px-4 pt-5 pb-6">
          <h3 className="text-base leading-[1.5] font-semibold tracking-[-0.02em] text-[#101D37]">Project</h3>
          <ul className="mt-5 flex w-[186px] flex-col gap-[10px]">
            {PROJECT_PAGES.map((pg, i) => {
              const on = pg.key === activePage;
              return (
                <li key={pg.key} className="flex flex-col gap-[10px]">
                  {i > 0 && <div className="h-px w-full bg-[#EDEDF0]" />}
                  <Link
                    href={`${V2}/projects/${activeId}/${pg.key}`}
                    aria-current={on ? "page" : undefined}
                    className={`flex items-center gap-2 text-xs leading-[1.5] tracking-[-0.02em] hover:text-[#101D37] ${
                      on ? "font-semibold text-[#101D37]" : "text-body"
                    }`}
                  >
                    <Icon icon={huge(pg.icon)} size={13} stroke={1.1} className="shrink-0" />
                    <span className="truncate">{pg.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </aside>
  );
}
