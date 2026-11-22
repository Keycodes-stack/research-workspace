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
