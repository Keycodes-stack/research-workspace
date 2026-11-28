"use client";

import dynamic from "next/dynamic";
import TopBar from "@/components/v2/dashboard/TopBar";
import ProjectsPanel from "@/components/v2/dashboard/ProjectsPanel";
import { V2 } from "@/lib/v2/routes";

/* Syncfusion touches `window` on import, so the editor only loads in the browser. */
const DocEditor = dynamic(() => import("@/components/v2/workspace/DocEditor"), {
  ssr: false,
  loading: () => <div className="flex flex-1 items-center justify-center py-20 text-sm text-body">Loading editor…</div>,
});

/**
 * The Workspace page of one work package: the Word-style document editor with the comments panel, as in the
 * Artifex Labs reference (Projects - Workspace).
 */
export default function WorkPackageWorkspace({ projectId, taskId }: { projectId: string; taskId: string }) {
  return <div className="flex min-w-0 flex-1">
    <ProjectsPanel activeId={projectId} showWorkPackages activeSection="workspace" />
    <div className="flex min-w-0 flex-1 flex-col">
      <TopBar current="Workspace" trail={[{ label: "Projects", href: `${V2}/projects` }]} />
      {/* Findings live inside the document now: clicking one opens its detail in the
          right sidebar (DocEditor applies the links at load time). No panel above. */}
      {/* keyed by work package: opening another one re-creates the editor instead of keeping the previous document */}
      <DocEditor key={taskId} taskId={taskId} projectId={projectId} />
    </div>
  </div>;
}
