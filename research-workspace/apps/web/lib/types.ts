export type Mode = "open_discovery" | "closed_repository";
export type TaskStatus = "draft" | "approved" | "running" | "complete";
export type AnswerKind = "consensus" | "disagreement" | "insufficient_evidence";

export interface Project { id: string; name: string; mode: Mode; created_at?: string; role?: string }
export interface SourceRow {
  id: string; title: string | null; doi: string | null; filename: string | null;
  origin: string; fulltext: string; year: number | null; page_count: number | null; chunks: number;
}
export interface TaskRow { id: string; title: string; brief: string | null; status: TaskStatus; created_at: string }
export interface ThreadRow { id: string; title: string | null; created_at: string }
export interface TaskDetail {
  id: string; project_id: string; title: string; status: TaskStatus; mode: Mode;
  source_lock_hash: string | null; source_ids: string[]; threads: ThreadRow[];
}

export interface ChunkMeta {
  label: string; source_id: string; filename: string | null; doi: string | null;
  page_start: number | null; page_end: number | null; sha256: string; text: string;
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
}
export interface AskResult {
  message_id: string; kind: AnswerKind; reason: string; content: string;
  claims: FinalClaim[]; disagreement: Disagreement | null; top_similarity: number | null;
  verification: { status: string; verified: number; purged: number };
  gate: Gate; chunks: Record<string, ChunkMeta>;
}
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

export interface Member { user_id: string; role: string; created_at: string }
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
