"use client";

import Link from "next/link";
import type { EvidenceRun } from "@/lib/types";
import { V2 } from "@/lib/v2/routes";

const CHIP: Record<string, { label: string; cls: string }> = {
  not_started: { label: "Not started", cls: "bg-[#F2F4F7] text-[#344054]" },
  queued: { label: "Queued", cls: "bg-[#F2F4F7] text-[#344054]" },
  running: { label: "Researching…", cls: "bg-[#EFF8FF] text-[#1849A9]" },
  complete: { label: "Complete", cls: "bg-[#ECFDF3] text-[#067647]" },
  failed: { label: "Failed", cls: "bg-[#FEF3F2] text-[#B42318]" },
  waiting: { label: "Waiting for sources", cls: "bg-[#FFFAEB] text-[#B54708]" },
};

const fmtStarted = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
};

/**
 * Research runs for one project, on Home. The project id comes from the
 * ?project= parameter a Run / Run again click lands here with — never from
 * Home's Ask project list, which only holds open-discovery projects while a
 * run's project may be closed-repository. The just-started run (?running=)
 * is highlighted. There is no progress % anywhere: the backend exposes only
 * status (and papers_read at finish), so a running row shows an indeterminate
 * spinner, never a determinate bar.
 */
export default function RunStatusCard({
  projectId,
  highlightTaskId,
  runs,
  loading,
  error,
  onRetry,
}: {
  projectId: string;
  highlightTaskId: string | null;
  runs: EvidenceRun[];
  loading: boolean;
  error: string | null;
  onRetry: (taskId: string) => void;
}) {
  return (
    <section aria-label="Research running" className="rounded-[20px] border border-[#EDEDF0] bg-white p-5">
      <h2 className="text-base leading-[1.5] font-medium tracking-[-0.02em] text-[#101D37]">Research running</h2>
      {error && <p role="alert" className="mt-2 text-sm text-[#B42318]">{error}</p>}
      {loading && <p className="mt-2 text-sm text-body">Loading research status…</p>}
      {!loading && runs.length === 0 && (
        <p className="mt-2 text-sm text-body">No research runs for this project yet.</p>
      )}
      {runs.length > 0 && (
        <ul className="mt-3 flex flex-col gap-3">
          {runs.map((run) => {
            const chip = CHIP[run.status] ?? CHIP.not_started;
            const active = run.status === "queued" || run.status === "running";
            const highlighted = run.task_id === highlightTaskId;
            return (
              <li
                key={run.task_id}
                className={`rounded-[14px] border p-4 ${highlighted ? "border-[#98A2B3]" : "border-[#EDEDF0]"}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  {active && (
                    <span aria-hidden className="size-3.5 animate-spin rounded-full border-2 border-[#D0D5DD] border-t-[#1849A9]" />
                  )}
                  <p className="font-semibold text-[#101D37]">
                    {run.code ? `${run.code} · ` : ""}{run.work_package_title ?? "Work package"}
                  </p>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${chip.cls}`}>{chip.label}</span>
                  {highlighted && <span className="text-xs text-body">· just started</span>}
                </div>
                {fmtStarted(run.started_at) && (
                  <p className="mt-1 text-xs text-body">Started {fmtStarted(run.started_at)}</p>
                )}
                {run.status === "complete" && (
                  <p className="mt-1 text-sm text-body">
                    {run.papers_read} papers read{run.statement ? ` · ${run.statement}` : ""}
                  </p>
                )}
                {run.status === "failed" && (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <p className="text-sm text-[#B42318]">{run.error || "The research failed."}</p>
                    <button
                      type="button"
                      onClick={() => onRetry(run.task_id)}
                      className="rounded-[10px] bg-blue px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      Retry
                    </button>
                  </div>
                )}
                <Link
                  href={`${V2}/projects/${projectId}/evidence?work_package=${run.task_id}`}
                  className="mt-2 inline-block text-sm font-medium text-blue"
                >
                  View evidence →
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
