"use client";

import Link from "next/link";
import type { EvidenceItem } from "@/lib/types";
import { V2 } from "@/lib/v2/routes";

/**
 * One finding's detail in the Workspace right sidebar (the column that normally
 * shows Comments). Opened by clicking the finding inside the document — the
 * document's Findings are plain text, so the link is applied in the editor at
 * load time and this panel is fed by the work package's evidence items.
 * "Back to comments" returns to the Comments panel; "View in Evidence" opens
 * the work package's Evidence tab (the Evidence page itself is not modified).
 */
export default function FindingDetail({
  item,
  projectId,
  taskId,
  onBack,
}: {
  item: EvidenceItem;
  projectId: string;
  taskId: string;
  onBack: () => void;
}) {
  return (
    <aside aria-label="Finding detail" className="flex h-full w-[215px] shrink-0 flex-col border-l border-[#EDEDF0] bg-white">
      <div className="flex items-center justify-between px-4 pt-5 pb-3">
        <h2 className="text-base leading-[1.5] font-semibold tracking-[-0.02em] text-[#101D37]">
          Finding
        </h2>
        <button
          type="button"
          onClick={onBack}
          className="text-xs leading-[1.5] font-medium tracking-[-0.02em] text-[#344054] hover:text-[#101D37]"
        >
          ← Comments
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
        <p className="text-sm leading-[1.5] tracking-[-0.02em] text-[#101D37]">{item.claim_text}</p>
        <div className="flex flex-wrap items-center gap-2">
          {item.status === "verified"
            ? <span className="rounded-full bg-[#ECFDF3] px-2.5 py-0.5 text-xs font-medium text-[#067647]">Verified</span>
            : <span className="rounded-full bg-[#FFFAEB] px-2.5 py-0.5 text-xs font-medium text-[#B54708]">Pending verification</span>}
          {!item.confirmed && (
            <span className="text-xs text-[#344054]">(one model only)</span>
          )}
        </div>
        <p className="text-xs leading-[1.5] tracking-[-0.02em] text-body">
          {item.evidence_id}
          {item.source_title ? ` · ${item.source_title}` : ""}
        </p>
        <Link
          href={`${V2}/projects/${projectId}/evidence?work_package=${taskId}`}
          className="text-xs font-semibold leading-[1.5] tracking-[-0.02em] text-[#344054] hover:text-[#101D37]"
        >
          View in Evidence →
        </Link>
      </div>
    </aside>
  );
}
