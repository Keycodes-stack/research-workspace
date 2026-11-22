"use client";
import Link from "next/link";
import { use } from "react";
import Shell from "@/components/Shell";
import ProjectNav from "@/components/ProjectNav";
import { STAGE_LABEL } from "@/components/PipelinePanel";
import { useLoad } from "@/components/useLoad";
import { api } from "@/lib/api";

function Body({ id }: { id: string }) {
  const project = useLoad(() => api.project(id), [id]);
  const b = useLoad(() => api.board(id), [id]);
  if (b.error) return <div className="notice error" role="alert">{b.error}</div>;
  const data = b.data;
  if (!data) return <p className="muted">Loading…</p>;
  return (
    <div className="stack">
      <ProjectNav
        projectId={id}
        activeTab="pipeline"
        projectName={project.data?.name}
        role={project.data?.role}
      />
      <div className="card"><h1>Innovation pipeline</h1>
        <p className="muted">Concepts move one stage at a time. Each move needs a reason, passes computed gates, and is written to a log nobody can edit.</p></div>
      <div className="row" style={{ alignItems: "flex-start", overflowX: "auto" }}>
        {data.order.map((s) => (
          <div key={s} className="card stack" style={{ minWidth: 190, flex: 1 }} data-testid={`stage-${s}`}>
            <h3>{STAGE_LABEL[s]} <span className="muted">({data.stages[s].length})</span></h3>
            {data.stages[s].map((c) => <Link key={c.id} href={`/concepts/${c.id}`}>{c.title}</Link>)}
            {data.stages[s].length === 0 && <span className="muted">Empty</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Shell crumbs={<><Link href="/">Projects</Link> / <Link href={`/projects/${id}`}>Project</Link></>}><Body id={id} /></Shell>;
}
