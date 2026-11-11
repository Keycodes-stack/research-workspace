"use client";
import Link from "next/link";

export type ProjectTabKey = "overview" | "signals" | "concepts" | "pipeline" | "admin" | "intelligence";

interface ProjectNavProps {
  projectId: string;
  activeTab: ProjectTabKey;
  projectName?: string;
  role?: string;
}

export default function ProjectNav({ projectId, activeTab, projectName, role }: ProjectNavProps) {
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
