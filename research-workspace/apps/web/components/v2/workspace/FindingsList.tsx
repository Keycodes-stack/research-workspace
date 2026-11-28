"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { EvidenceItem } from "@/lib/types";
import { V2 } from "@/lib/v2/routes";

/**
 * Clickable Findings for one work package.
 *
 * The Workspace document itself is a Syncfusion SFDT document whose Findings are plain text
 * (claim + [source-number]) with no evidence id in them, so a finding inside the document cannot
 * be made clickable. This list is driven by the work package's evidence items instead — one
 * evidence item is one finding (same claim text, same chunks) — so every row below IS the finding
 * and its link target at once. The whole highlighted row is the link: clicking it opens the
 * Evidence tab for this work package (the app's existing route), where that finding's record
 * sits with its source, quote and "View evidence details" button. The Evidence page itself is
 * not modified.
 */
export default function FindingsList({ projectId, taskId }: { projectId: string; taskId: string }) {
  const [items, setItems] = useState<EvidenceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let live = true;
    setItems(null);
    setError(null);
    api.taskEvidence(taskId)
      .then((r) => { if (live) setItems(r.items ?? []); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : "Could not load the findings."); });
    return () => { live = false; };
  }, [taskId]);

  return (
    <section aria-label="Findings" className="px-4 pt-6 sm:px-6 lg:px-10">
      <div className="rounded-[20px] border border-[#EDEDF0] bg-[#FAFAFA] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-[#101D37]">
              Findings {items !== null && `(${items.length})`}
            </h2>
            <p className="mt-0.5 text-xs text-body">
              Click a finding to open the evidence it came from.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="rounded-[10px] border border-[#EDEDF0] bg-white px-3 py-1.5 text-xs font-semibold text-[#344054] hover:border-[#D0D5DD]"
          >
            {collapsed ? "Show findings" : "Hide findings"}
          </button>
        </div>

        {!collapsed && (
          <>
            {error && <p role="alert" className="mt-3 text-sm text-[#B42318]">{error}</p>}
            {items === null && !error && (
              <p className="mt-3 text-sm text-body">Loading findings…</p>
            )}
            {items !== null && items.length === 0 && (
              <p className="mt-3 text-sm text-body">
                No evidence yet for this work package. Findings will appear here once research runs.
              </p>
            )}
            {items !== null && items.length > 0 && (
              <ul className="mt-3 flex flex-col gap-2">
                {items.map((it, i) => (
                  <li key={it.id}>
                    <Link
                      href={`${V2}/projects/${projectId}/evidence?work_package=${taskId}`}
                      aria-label={`${it.evidence_id}: ${it.claim_text} — open its evidence`}
                      className="block rounded-xl border border-blue/40 bg-[#EFF5FF] p-3 text-left transition hover:border-blue hover:bg-[#DBEAFE] focus-visible:outline-2 focus-visible:outline-blue"
                    >
                      <span className="flex flex-wrap items-start justify-between gap-2">
                        <span className="min-w-0 flex-1 text-sm text-[#101D37]">
                          <span className="mr-2 inline-block rounded-md bg-blue px-1.5 py-0.5 text-[11px] font-semibold text-white">
                            [{i + 1}]
                          </span>
                          {it.claim_text}
                          {!it.confirmed && (
                            <span className="text-[#344054]"> (one model only)</span>
                          )}
                        </span>
                        {it.status === "verified"
                          ? <span className="shrink-0 rounded-full bg-[#ECFDF3] px-2.5 py-0.5 text-xs font-medium text-[#067647]">Verified</span>
                          : <span className="shrink-0 rounded-full bg-[#FFFAEB] px-2.5 py-0.5 text-xs font-medium text-[#B54708]">Pending verification</span>}
                      </span>
                      <span className="mt-1.5 block text-xs text-body">
                        {it.evidence_id}
                        {it.source_title ? ` · ${it.source_title}` : ""}
                        {" · View evidence →"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
