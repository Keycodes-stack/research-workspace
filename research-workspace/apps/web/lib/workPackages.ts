import type { TaskRow } from "./types";

/**
 * A work package: the fields entered for it individually (its workstream, from the brief JSON
 * written by the project wizard) plus its work_packages row. Project-wide fields live on the project.
 */
export type WorkPackage = {
  id: string;
  title: string;
  output: string;
  owner: string;
  department: string;
  status: string;
  /** Team, reviewer, dates and dependencies entered for this package in the wizard. */
  team: string;
  reviewer: string;
  start: string;
  due: string;
  dependencies: string;
  /** The package's own objective and approach (project-wide text in the brief, kept per package). */
  objective: string;
  approach: string;
  /** Free-text brief typed into "+ New work package", or a brief that is not wizard JSON. */
  brief: string;
  /** Titles of the packages this one depends on (from work_package_dependencies). */
  dependsOn: string[];
  /** From the work_packages row; null for a task without one. */
  code: string | null;
  stage: string | null;
  progress: number | null;
  lead: string | null;
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
  let brief: Record<string, unknown> = {};
  let plainBrief = "";
  try {
    const parsed: unknown = JSON.parse(task.brief ?? "{}");
    if (parsed && typeof parsed === "object") brief = parsed as Record<string, unknown>;
    else plainBrief = task.brief ?? "";
  } catch {
    // A brief typed by hand (chat or "+ New work package") is not JSON; keep it as the description.
    plainBrief = task.brief ?? "";
  }
  const workstream = brief.workstream && typeof brief.workstream === "object" ? brief.workstream as Record<string, unknown> : {};
  const text = (source: Record<string, unknown>, key: string) => (typeof source[key] === "string" ? (source[key] as string) : "");
  return {
    id: task.id,
    title: task.title,
    output: text(workstream, "output"),
    owner: text(workstream, "owner") || (task.lead_id ?? "") || "Not assigned",
    department: text(workstream, "department"),
    status: statusLabel(task.status),
    team: text(workstream, "team"),
    reviewer: text(workstream, "reviewer"),
    start: text(workstream, "start"),
    due: text(workstream, "due") || task.due_date || "",
    dependencies: text(workstream, "dependencies") || text(brief, "dependencies"),
    objective: text(brief, "objective"),
    approach: text(brief, "approach"),
    brief: plainBrief,
    dependsOn: task.depends_on ?? [],
    code: task.code ?? null,
    stage: task.stage ?? null,
    progress: task.progress ?? null,
    lead: task.lead_id ?? null,
  };
}
