import type { Mode } from "./types";

export type ProjectWorkstream = {
  name: string;
  department: string;
  team: string;
  output: string;
  owner: string;
  reviewer: string;
  start: string;
  due: string;
  dependencies: string;
};

export type ProjectGate = {
  name: string;
  owner: string;
  approver: string;
  date: string;
  criteria: string;
  workstreams: string[];
};

export type ProjectRisk = {
  risk: string;
  owner: string;
  severity: string;
  response: string;
};

export type ProjectDraft = {
  mode: Mode;
  name: string;
  type: string;
  objective: string;
  background: string;
  governance: string;
  priority: string;
  programme: string;
  business_unit: string;
  start: string;
  target: string;
  in_scope: string;
  out_scope: string;
  deliverable: string;
  measures: string;
  assumptions: string;
  dependencies: string;
  sponsor: string;
  lead: string;
  departments: string[];
  team_mode: string;
  teams: string[];
  stakeholders: string;
  decision_notes: string;
  external_orgs: string;
  workstreams: ProjectWorkstream[];
  gates: ProjectGate[];
  risks: ProjectRisk[];
  no_risk_reason: string;
  approach: string;
  reporting: string;
  budget: string;
  currency: string;
  resources: string;
  controls_mode: string;
  visibility: string;
  classification: string;
  plan_editing: string;
  manage_access: string;
  approvals: string;
  change_authority: string;
  standards: string;
  quality_lead: string;
  gate_rule: string;
  reg_controls: string[];
  data_location: string;
  retention: string;
  external_access: string;
};

export const EMPTY_PROJECT_DRAFT: ProjectDraft = {
  mode: "open_discovery",
  name: "", type: "Research & Development", objective: "", background: "",
  governance: "Controlled", priority: "Normal", programme: "", business_unit: "",
  start: "", target: "", in_scope: "", out_scope: "", deliverable: "", measures: "",
  assumptions: "", dependencies: "", sponsor: "", lead: "", departments: [], team_mode: "Assign participating teams now",
  teams: [], stakeholders: "", decision_notes: "", external_orgs: "", workstreams: [], gates: [], risks: [], no_risk_reason: "",
  approach: "Phased", reporting: "Monthly", budget: "", currency: "USD", resources: "",
  controls_mode: "Controlled", visibility: "Project members only", classification: "Confidential",
  plan_editing: "Project lead and admins", manage_access: "Project lead and admins",
  approvals: "Department reviewers, then project lead", change_authority: "Sponsor and project lead",
  standards: "", quality_lead: "", gate_rule: "Sponsor and accountable reviewers", reg_controls: [],
  data_location: "", retention: "", external_access: "No external access",
};

export const PROJECT_SECTIONS = ["Charter", "Organization", "Delivery", "Controls", "Review"] as const;
export type ProjectQuestion = {
  header: string;
  question: string;
  multi_select: boolean;
  options: { label: string; description?: string }[];
};
export type IntakeResponse = {
  patch: Partial<ProjectDraft>;
  reply: string;
  questions: ProjectQuestion[];
  done: boolean;
  model: string;
};

export type RiskLevel = "Low" | "Medium" | "High";
/** First AI assessment of a project, saved with the project in meta.insights. */
export type ProjectInsights = {
  summary: string;
  recommendation: string;
  feasibility: number;
  stats: { label: string; value: string }[];
  risks: { risk: string; likelihood: RiskLevel; impact: RiskLevel; mitigation: string; owner: string }[];
  questions: string[];
  nextSteps: string[];
  model: string;
  generatedAt: string;
};

/** Accept only a well-formed assessment (projects saved before this feature have none). */
export function asInsights(raw: unknown): ProjectInsights | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Partial<ProjectInsights>;
  if (typeof f.summary !== "string" || typeof f.feasibility !== "number") return null;
  return {
    summary: f.summary,
    recommendation: typeof f.recommendation === "string" ? f.recommendation : "",
    feasibility: f.feasibility,
    stats: Array.isArray(f.stats) ? f.stats : [],
    risks: Array.isArray(f.risks) ? f.risks : [],
    questions: Array.isArray(f.questions) ? f.questions.filter((x): x is string => typeof x === "string") : [],
    nextSteps: Array.isArray(f.nextSteps) ? f.nextSteps.filter((x): x is string => typeof x === "string") : [],
    model: typeof f.model === "string" ? f.model : "",
    generatedAt: typeof f.generatedAt === "string" ? f.generatedAt : "",
  };
}

/* Limits for every charter text box. They mirror services/ai/app/routes_tasks.py (_INTAKE_TEXT, _LIST_TEXT,
 * _OBJECT_LISTS): the browser stops typing and pasting at these lengths, and the server rejects anything longer. */
export const FIELD_LIMITS: Record<string, number> = {
  name: 120, type: 80, objective: 1200, background: 1200, governance: 80, priority: 30, programme: 120,
  business_unit: 120, start: 10, target: 10, in_scope: 1200, out_scope: 1200, deliverable: 500, measures: 800,
  assumptions: 800, dependencies: 800, sponsor: 120, lead: 120, team_mode: 80, stakeholders: 800,
  no_risk_reason: 500, decision_notes: 800, external_orgs: 500, approach: 50, reporting: 50, budget: 80,
  currency: 8, resources: 800, controls_mode: 80, visibility: 80, classification: 40, plan_editing: 80,
  manage_access: 80, approvals: 120, change_authority: 100, standards: 500, quality_lead: 120, gate_rule: 100,
  data_location: 120, retention: 200, external_access: 80,
};
/** Per-item limits of list fields (departments, teams, quality checks) and the maximum number of items. */
export const LIST_LIMITS: Record<string, { item: number; max: number }> = {
  departments: { item: 100, max: 12 }, teams: { item: 160, max: 12 }, reg_controls: { item: 120, max: 12 },
};
/** Row limits for workstreams, gates and risks: per-field length and maximum row count. */
export const ROW_LIMITS = {
  workstreams: { max: 8, fields: { name: 140, department: 100, team: 120, output: 300, owner: 120, reviewer: 120, start: 10, due: 10, dependencies: 300 } },
  gates: { max: 8, fields: { name: 140, owner: 120, approver: 120, date: 10, criteria: 500 } },
  risks: { max: 12, fields: { risk: 300, owner: 120, severity: 20, response: 500 } },
} as const;

/** Human-readable list of charter values longer than their limits (empty when everything fits). */
export function charterOverLimits(draft: ProjectDraft): string[] {
  const problems: string[] = [];
  for (const [key, limit] of Object.entries(FIELD_LIMITS)) {
    const value = draft[key as keyof ProjectDraft];
    if (typeof value === "string" && value.trim().length > limit) problems.push(`${key} (${value.trim().length} of ${limit} characters)`);
  }
  for (const [key, { item, max }] of Object.entries(LIST_LIMITS)) {
    const list = draft[key as keyof ProjectDraft] as string[];
    if (list.length > max) problems.push(`${key} (${list.length} of at most ${max})`);
    if (list.some((x) => x.trim().length > item)) problems.push(`${key} (an item is over ${item} characters)`);
  }
  for (const [key, { max, fields }] of Object.entries(ROW_LIMITS)) {
    const rows = draft[key as keyof ProjectDraft] as unknown as Record<string, string>[];
    if (rows.length > max) problems.push(`${key} (${rows.length} of at most ${max})`);
    for (const row of rows) {
      for (const [name, limit] of Object.entries(fields)) {
        const value = row[name];
        if (typeof value === "string" && value.trim().length > limit) problems.push(`${key}.${name} (${value.trim().length} of ${limit} characters)`);
      }
    }
  }
  return problems;
}
