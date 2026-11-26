export type Mode = "open_discovery" | "closed_repository";
export type TaskStatus = "draft" | "approved" | "running" | "complete";
export type AnswerKind = "consensus" | "disagreement" | "insufficient_evidence";

export interface Project {
  id: string; name: string; mode: Mode; created_at?: string; role?: string;
  /** URL name (spec /projects/[slug]); null for projects created before slugs existed. */
  slug?: string | null;
  /** Draft, Active, In Progress, Pending Approval, Completed or Parked. */
  status?: string;
  /** Reference code shown in the directory, e.g. P-010. */
  code?: string | null;
  governance_stage?: string;
  project_lead?: string | null;
  /** Number of work packages and the average of their progress (null when there are none). */
  work_packages?: number;
  progress?: number | null;
  /** String summaries plus the structured project charter saved on creation. */
  meta?: Record<string, unknown>;
}
export interface SourceRow {
  id: string; title: string | null; doi: string | null; filename: string | null;
  origin: string; fulltext: string; year: number | null; page_count: number | null; chunks: number;
}
/** A research task. The work package fields come from its work_packages row (null for a task without one). */
export interface TaskRow {
  id: string; title: string; brief: string | null; status: TaskStatus; created_at: string;
  code?: string | null; lead_id?: string | null; due_date?: string | null; stage?: string | null; progress?: number | null;
  /** Titles of the work packages this one depends on. */
  depends_on?: string[];
}
export type GateStatus = "Pending" | "Approved" | "Changes Requested";
/** A decision gate as stored for the project. */
export interface DecisionGate {
  id: string; gate_name: string; target_date: string | null; decision_owner: string | null; approver: string | null;
  acceptance_criteria: string | null; gate_scope: string | null; status: GateStatus; decided_at: string | null;
}
/** A person in the organization's directory (sponsors, project leads and core team are chosen from it). */
export interface Person { id: string; full_name: string; email: string | null; department: string | null; job_title: string | null; active: boolean }
export interface AttachmentRow { id: string; filename: string; content_type: string; size_bytes: number; created_at: string }
export interface WorkPackageComment {
  id: string; author: string; body: string; resolved: boolean; created_at: string;
  /** The text the comment is about (null for replies). */
  anchor_text: string | null;
  /** The first comment of the thread, for replies. */
  parent_id: string | null;
  resolved_by: string | null; resolved_at: string | null;
}
export interface ThreadRow { id: string; title: string | null; created_at: string }
export interface TaskDetail {
  id: string; project_id: string; title: string; status: TaskStatus; mode: Mode;
  source_lock_hash: string | null; source_ids: string[]; threads: ThreadRow[];
}

export interface ChunkMeta {
  label: string; source_id: string; filename: string | null; doi: string | null;
  page_start: number | null; page_end: number | null; sha256: string; text: string;
  /** user_upload | openalex | europe_pmc | unpaywall ...; a link to the paper (DOI or source URL) when known */
  origin?: string; url?: string | null;
}
export interface FinalClaim {
  text: string; chunk_ids: string[]; quote: string; conditions: string | null;
  confirmed: boolean; match_kind: string | null; match_score: number; seals: Record<string, string>;
}
export interface Position {
  text: string; conditions: string | null; chunk_ids: string[]; quote: string;
  verified: boolean; match_kind: string | null; seals: Record<string, string>;
}
export interface Conflict {
  topic: string; position_a: Position | null; position_b: Position | null;
  explanation: string; detected_by: "judge" | "numeric" | "status";
}
export interface ModelClaim { text: string; conditions: string | null; chunk_ids: string[]; quote: string }
export interface Disagreement {
  reason: string; conflicts: Conflict[]; model_a_claims: ModelClaim[]; model_b_claims: ModelClaim[];
}
export interface Gate {
  threshold: number; top_similarity: number | null; passed: boolean; corrupt_chunks_dropped: number;
  /** open discovery: where the answer came from, how many sources were searched and read */
  evidence_from?: "online_search" | "saved_sources"; saved_sources?: number; papers_read?: number;
  online?: { found?: number; stored?: number; full_text?: number; abstract_only?: number } | null;
}
export interface AskResult {
  message_id: string; kind: AnswerKind; reason: string; content: string;
  claims: FinalClaim[]; disagreement: Disagreement | null; top_similarity: number | null;
  verification: { status: string; verified: number; purged: number };
  gate: Gate; chunks: Record<string, ChunkMeta>;
  related?: string[];   // closest passages when nothing could be verified (shown as unverified evidence)
  work_package?: { task_id: string; code: string; title: string };   // the chat's work package in this project
  timings?: { total_s?: number };
  /** Each model's own claims and verdict. Absent on answers saved before the side-by-side view. */
  models?: Partial<Record<"model_a" | "model_b", ModelBreakdown>> | null;
  /** The closing statement from the cross-check. Absent on older answers. */
  statement?: string | null;
  /** Points where the papers or conditions differ (lenient cross-check); each keeps both citations. */
  differences?: Conflict[] | null;
}
export interface ModelBreakdown {
  verified: number; purged: number;
  /** "answered" or "insufficient_source_evidence" */
  status?: string | null; notes?: string | null;
  claims: { text: string; quote: string; verified: boolean; reason: string; match_kind: string | null; chunk_ids: string[] }[];
}
/** Sources for an open-discovery question: uploads only, online papers only, or both. */
export type EvidenceScope = "uploads" | "api" | "both";
/** A follow-up the project's saved sources did not cover: the client is told first, then asks again online. */
export interface NotInSavedSources { kind: "not_in_saved_sources"; note: string; saved_sources: number }
export interface ChatRow { id: string; title: string; created_at: string; updated_at: string; turns: number }
export interface Message {
  id: string; role: "user" | "assistant"; content: string; answer_kind: AnswerKind | null;
  top_similarity: number | null; created_at: string; final: AskResult | null;
}

export type SignalCategory = "trend" | "opportunity" | "risk";
export type SignalStatus = "new" | "dismissed" | "merged" | "promoted";
export type Confidence = "high" | "medium" | "low";
export interface Signal {
  id: string; category: SignalCategory; text: string; status: SignalStatus; confidence: Confidence;
  models_agree: boolean; source_count: number; merged_into: string | null; created_at: string;
}
export interface SignalEvidence {
  id: string; chunk_id: string; quote: string; model: string; match_kind: string | null; label: string;
  page_start: number | null; page_end: number | null; chunk_text: string; intact: boolean;
}
export interface SignalDetail extends Signal { status_reason: string | null; evidence: SignalEvidence[] }
export interface ScanResult { created: number; already_known: number; skipped: { category: string; reason: string }[] }

export interface ConceptRow { id: string; title: string; status: string; created_at: string; evidence: number }
export interface ConceptEvidence {
  id: string; claim_text: string; quote: string; model: string; label: string; page_start: number | null; intact: boolean;
}
export interface Section { key: string; body: string; version: number }
export interface Rubric {
  human: Record<string, { average: number | null; raters: number; mine: number | null }>;
  evidence: { score: number; statements: number; sources: number; both_models: number; excluded_changed_sources: number };
  note: string;
}
export interface ConceptDetail {
  id: string; project_id: string; title: string; status: string; sections: Record<string, Section>;
  evidence: ConceptEvidence[]; rubric: Rubric;
}
export interface LensItem {
  text: string; models_agree: boolean;
  evidence: { quote: string; label: string; page_start: number | null; model: string; intact: boolean }[];
}
export type Lenses = Record<string, { status: string; items: LensItem[] }>;

export interface PipelineGate { name: string; passed: boolean; detail: string; overridable: boolean }
export interface Gates { stage: string; next: string | null; gates: PipelineGate[]; ready: boolean }
export interface Decision {
  id: string; action: string; from_stage: string; to_stage: string; reason: string; override: boolean;
  gates: PipelineGate[]; created_at: string;
}
export interface Board { order: string[]; stages: Record<string, { id: string; title: string; stage: string; status: string }[]> }

export interface Member { user_id: string; role: string; role_id: string | null; role_name: string | null; created_at: string }
/** A role a project defines for itself. Its level (viewer … owner) is what the access rules use. */
export interface ProjectRole { id: string; name: string; level: string; members: number }
export interface Members { you: string; members: Member[]; permissions: { capability: string; min_role: string }[] }
export interface AuditEntry { id: number; actor: string; action: string; target_type: string | null; target_id: string | null; detail: Record<string, unknown>; created_at: string }
export interface Usage {
  month_calls: number; monthly_call_budget: number | null; remaining: number | null;
  by_kind: { kind: string; operations: number; model_calls: number; chars_in: number; chars_out: number }[];
  by_user: { user_id: string; model_calls: number }[]; note: string;
}

export interface PresenceUser { user_id: string; section: string | null; last_seen: string }
export interface LockInfo { section: string; user_id: string; expires_at: string }
export interface CommentRow {
  id: string; parent_id: string | null; section: string | null; author: string; stance: "support" | "challenge" | "question" | "note";
  body: string; resolved: boolean; created_at: string;
}
export interface CommentsResp { comments: CommentRow[]; summary: Record<string, Record<string, number>>; note: string }

/* ---- Evidence Library (work package research: papers -> top 10 -> both models -> judge) ---- */
export type EvidenceStatus = "verified" | "pending";
export type EvidenceRunStatus = "not_started" | "queued" | "running" | "complete" | "failed" | "waiting";
export type EvidenceModels = Partial<Record<"model_a" | "model_b", { label: string }>>;

export type EvidenceRun = {
  task_id: string;
  status: EvidenceRunStatus;
  question: string;
  statement: string | null;
  papers_read: number;
  models: EvidenceModels;
  error: string | null;
  references_added: boolean;
  started_at: string;
  finished_at: string | null;
  code?: string | null;
  work_package_title?: string | null;
  sources?: { papers: number; uploads: number };   // source register counts for this work package
};

export type EvidenceItem = {
  id: string;
  evidence_id: string;            // "Evidence 001"
  task_id: string;
  work_package_code: string | null;
  work_package_title: string | null;
  claim_text: string;
  quote: string;
  status: EvidenceStatus;
  found_by: ("model_a" | "model_b")[];
  confirmed: boolean;
  chunk_ids: string[];
  source_id: string | null;
  source_title: string | null;
  doi: string | null;
  source_url: string | null;
  origin: string | null;
  pub_year: number | null;
  created_at: string | null;
};

export type EvidenceMeasurement = {
  text: string;                   // as written in the source: "480 °C", "$142k"
  value: number;
  unit: string;
  evidence_id: string | null;     // the evidence record it was found in
  work_package_code: string | null;
  source_title: string | null;
};

export type EvidenceLibrary = {
  summary: { total_sources: number; claims_supported: number; need_verification: number };
  models: EvidenceModels;
  runs: EvidenceRun[];
  items: EvidenceItem[];
  measurements?: EvidenceMeasurement[];
};

/* Gate report for one work package (GET /tasks/{id}/evidence/report) */
export type GateReport = {
  generated_at: string;
  work_package: { code: string | null; title: string | null; stage: string | null; due_date: string | null };
  research: { status: EvidenceRunStatus; statement: string | null; papers_read: number; error: string | null;
              started_at: string | null; finished_at: string | null };
  approval: { status: "not_recorded"; note: string };
  evidence: { total: number; verified: number; pending: number; items: EvidenceItem[] };
  measurements: EvidenceMeasurement[];
  sources: { title: string | null; doi: string | null; origin: string | null; year: number | null; url: string | null }[];
  audit: { at: string | null; action: string }[];
};

/* Refinement bar: proposed field changes, shown before anything is written */
export type RefineChange = {
  target: "project" | "work_package";
  work_package_id: string | null;
  field: string;
  value: string;
  from?: string;
};
export type RefineProposal = { reply: string; changes: RefineChange[] };

export type EvidenceFilter = { q?: string; work_package?: string; model?: string; status?: string };

export type EvidenceDetail = {
  item: EvidenceItem;
  passages: { chunk_id: string; source_title: string | null; page_start: number | null; page_end: number | null; sha256: string; text: string }[];
  statement: string | null;
  models: EvidenceModels;
};
