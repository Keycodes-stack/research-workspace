import type { TaskRow } from "./types";

/** A work package as shown on the project overview, read from a saved task and its workstream brief. */
export type WorkPackage = {
  id: string;
  title: string;
  output: string;
  owner: string;
  department: string;
  status: string;
};

/** Saved task status → the label shown to users. Unknown statuses are shown as they are. */
const STATUS_LABEL: Record<string, string> = {
  draft: "Pending",
  pending_approval: "Pending",
  approved: "In Progress",
  running: "In Progress",
  complete: "Complete",
  failed: "Failed",
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

/** The workstream fields are stored in the task brief as JSON (see createProjectComplete in the frontend). */
export function workPackage(task: TaskRow): WorkPackage {
  let workstream: Record<string, unknown> = {};
  try {
    const brief = JSON.parse(task.brief ?? "{}") as { workstream?: unknown };
    if (brief.workstream && typeof brief.workstream === "object") workstream = brief.workstream as Record<string, unknown>;
  } catch {
    /* a brief that is not JSON has no workstream fields; the title still shows */
  }
  const text = (key: string) => (typeof workstream[key] === "string" ? (workstream[key] as string) : "");
  return {
    id: task.id,
    title: task.title,
    output: text("output"),
    owner: text("owner") || "Not assigned",
    department: text("department"),
    status: statusLabel(task.status),
  };
}
