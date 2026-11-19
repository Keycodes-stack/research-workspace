"use client";
import Link from "next/link";
import { Skeleton } from "@/components/Skeleton";

export type ProjectTabKey = "overview" | "signals" | "concepts" | "pipeline" | "admin" | "intelligence";

interface ProjectNavProps {
  projectId: string;
  activeTab: ProjectTabKey;
  projectName?: string;
  role?: string;
  /** When true, renders shimmer placeholders instead of real content. */
  loading?: boolean;
}

/** Skeleton version of the project nav — fake title bar + 6 tab pills. */
function ProjectNavSkeleton() {
  return (
    <nav className="project-nav-container skeleton-nav" aria-busy="true" aria-label="Loading project navigation">
      <div className="skeleton-nav-header">
        <Skeleton width="38%" height="1.6rem" />
        <Skeleton width={56} height="1.4rem" style={{ borderRadius: 999 }} />
      </div>
      <div className="skeleton-tabs">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton
            key={i}
            width={i === 0 ? 180 : i === 1 ? 110 : i === 2 ? 100 : i === 3 ? 90 : i === 4 ? 130 : 60}
            height="2rem"
            style={{ borderRadius: "8px 8px 0 0", flexShrink: 0 }}
          />
        ))}
      </div>
    </nav>
  );
}

export default function ProjectNav({ projectId, activeTab, projectName, role, loading }: ProjectNavProps) {
  if (loading) return <ProjectNavSkeleton />;

  const tabs: { key: ProjectTabKey; label: string; href: string; icon: string }[] = [
    { key: "intelligence", label: "R&D Intelligence (Halden)", href: `/intelligence`, icon: "✨" },
    { key: "overview", label: "Sources & Tasks", href: `/projects/${projectId}`, icon: "📂" },
    { key: "signals", label: "Signal Board", href: `/projects/${projectId}/signals`, icon: "📡" },
    { key: "concepts", label: "Concepts Hub", href: `/projects/${projectId}/concepts`, icon: "💡" },
    { key: "pipeline", label: "Pipeline (Kanban)", href: `/projects/${projectId}/pipeline`, icon: "📋" },
    { key: "admin", label: "Admin", href: `/projects/${projectId}/admin`, icon: "⚙️" },
  ];

  return (
    <nav className="project-nav-container">
      {projectName && (
        <div className="project-nav-header">
          <h1 className="project-nav-title">{projectName}</h1>
          {role && <span className="badge">Role: {role.replace("_", " ")}</span>}
        </div>
      )}
      <div className="project-tabs" role="tablist">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              className={`project-tab-link ${isActive ? "active" : ""}`}
              role="tab"
              aria-selected={isActive}
            >
              <span className="tab-icon">{tab.icon}</span>
              <span className="tab-label">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
