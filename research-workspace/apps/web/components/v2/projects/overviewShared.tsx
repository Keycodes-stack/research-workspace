import type { GateStatus } from "@/lib/types";

/** Pieces shared by the project overview and the work package overview. */

/** The sign-off states a decision gate can be in (the same values the database accepts). */
export const GATE_STATUSES: GateStatus[] = ["Pending", "Approved", "Changes Requested"];

export const dateLabel = (iso: string) =>
  iso ? new Date(`${iso}T00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "No date";

/** Priority chip colours follow the reference: high red, low green, otherwise amber. */
export function priorityChip(priority: string) {
  if (/urgent|high/i.test(priority)) return { text: "High Priority", cls: "bg-[#FEF3F2] text-[#B42318]" };
  if (/low/i.test(priority)) return { text: "Low Priority", cls: "bg-[#ECFDF3] text-[#067647]" };
  return { text: "Medium Priority", cls: "bg-[#FFFAEB] text-[#B54708]" };
}

export const STATUS_CLS: Record<string, string> = {
  Pending: "bg-[#F2F4F7] text-[#475467]",
  "In Progress": "bg-[#EFF4FF] text-blue",
  Complete: "bg-[#ECFDF3] text-[#067647]",
  Failed: "bg-[#FEF3F2] text-[#B42318]",
};

export function Stat({ value, label }: { value: string; label: string }) {
  return <div className="flex flex-col gap-1 rounded-[14px] border border-[#EDEDF0] bg-white p-5">
    <span className="text-2xl font-semibold text-blue">{value}</span>
    <span className="text-sm font-medium text-[#101D37]">{label}</span>
  </div>;
}

/** The project's charter object from its meta, or an empty object. */
export function charterOf(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  return meta?.charter && typeof meta.charter === "object" ? meta.charter as Record<string, unknown> : {};
}

/** A project-level text field: from the charter first, then the flat meta. */
export function projectText(meta: Record<string, unknown> | undefined, key: string): string {
  const charter = charterOf(meta);
  if (typeof charter[key] === "string") return charter[key] as string;
  return typeof meta?.[key] === "string" ? meta[key] as string : "";
}
