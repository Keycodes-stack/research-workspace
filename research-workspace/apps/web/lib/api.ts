import type {
  AskResult, AuditEntry, CommentsResp, LockInfo, PresenceUser, Board, ConceptDetail, Decision, Gates, ConceptRow, Lenses, Members, Message, Mode, Project, ScanResult, Signal, SignalCategory, SignalDetail, SourceRow, TaskDetail, TaskRow, Usage,
} from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080").replace(/\/$/, "");
const TOKEN_KEY = "kc_token";

export function getToken(): string | null {
  try { return window.localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t: string | null): void {
  try { t ? window.localStorage.setItem(TOKEN_KEY, t) : window.localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
}

/** The signed-in user's id, read from the token's `sub` for display only (the server never trusts this). */
export function currentUserId(): string | null {
  try {
    const part = getToken()?.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const sub = JSON.parse(json).sub;
    return typeof sub === "string" ? sub : null;
  } catch { return null; }
}

export class ApiError extends Error {
  constructor(public status: number, public detail: unknown, message: string) { super(message); }
  /** FastAPI wraps structured errors as {detail: {...}}. */
  get code(): string | null {
    const d = this.detail as { error?: string } | string | null;
    return d && typeof d === "object" && typeof d.error === "string" ? d.error : null;
  }
}

function describe(detail: unknown, status: number): string {
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object") {
    const d = detail as { detail?: unknown; note?: string; error?: string };
    if (d.error === "forbidden" && typeof (d as { required_role?: string }).required_role === "string")
      return `You need the ${(d as { required_role: string }).required_role.replace("_", " ")} role or higher for this.`;
    if (d.error === "budget_exceeded") return "This project's monthly model-call budget is used up. Ask an admin to raise it.";
    if (typeof d.note === "string") return d.note;
    if (Array.isArray(d.detail)) return "The request was not valid.";
    if (d.detail != null) return describe(d.detail, status);
    if (typeof d.error === "string") return d.error;
  }
  return `Request failed (${status})`;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, null, "Cannot reach the server. Check that the gateway is running.");
  }
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const detail = body && typeof body === "object" && "detail" in (body as object) ? (body as { detail: unknown }).detail : body;
    throw new ApiError(res.status, detail, describe(body, res.status));
  }
  return body as T;
}

const json = (b: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(b) });

/** POST that returns a file. Errors are parsed the same way as JSON calls. */
async function callBlob(path: string, body: unknown): Promise<{ blob: Blob; filename: string; fingerprint: string | null }> {
  const token = getToken();
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let res: Response;
  try { res = await fetch(`${API_URL}${path}`, { method: "POST", headers, body: JSON.stringify(body) }); }
  catch { throw new ApiError(0, null, "Cannot reach the server. Check that the gateway is running."); }
  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* not json */ }
    const detail = parsed && typeof parsed === "object" && "detail" in (parsed as object) ? (parsed as { detail: unknown }).detail : parsed;
    throw new ApiError(res.status, detail, describe(parsed, res.status));
  }
  const cd = res.headers.get("Content-Disposition") ?? "";
  const m = /filename="([^"]+)"/.exec(cd);
  return { blob: await res.blob(), filename: m?.[1] ?? "business_case.pdf", fingerprint: res.headers.get("X-Report-Fingerprint") };
}

export const api = {
  exportBusinessCase: (threadId: string, body: unknown) => callBlob(`/threads/${threadId}/export/business-case`, body),
  projects: () => call<{ projects: Project[] }>("/projects").then((r) => r.projects),
  project: (id: string) => call<Project>(`/projects/${id}`),
  createProject: (name: string, mode: Mode) => call<Project>("/projects", json({ name, mode })),
  sources: (pid: string) => call<{ sources: SourceRow[] }>(`/projects/${pid}/sources`).then((r) => r.sources),
  upload: (pid: string, file: File) => {
    const f = new FormData();
    f.append("file", file);
    return call<{ source_id: string; chunks?: number }>(`/projects/${pid}/sources/upload`, { method: "POST", body: f });
  },
  discover: (pid: string, question: string, topN = 8) =>
    call<{ sources: { title?: string; status?: string }[]; dropped: unknown[]; errors: string[] }>(
      `/projects/${pid}/discover-and-ingest`, json({ question, top_n: topN })),
  tasks: (pid: string) => call<{ tasks: TaskRow[] }>(`/projects/${pid}/tasks`).then((r) => r.tasks),
  createTask: (pid: string, title: string, brief?: string) =>
    call<{ id: string }>(`/projects/${pid}/tasks`, json({ title, brief: brief || null })),
  task: (id: string) => call<TaskDetail>(`/tasks/${id}`),
  setTaskSources: (id: string, source_ids: string[]) =>
    call<{ source_ids: string[] }>(`/tasks/${id}/sources`, { method: "PUT", body: JSON.stringify({ source_ids }) }),
  approve: (id: string) => call<{ status: string; source_lock_hash: string }>(`/tasks/${id}/approve`, { method: "POST" }),
  createThread: (taskId: string, title?: string) =>
    call<{ id: string }>(`/tasks/${taskId}/threads`, json({ title: title || null })),
  thread: (threadId: string) =>
    call<{ id: string; task_id: string; project_id: string }>(`/threads/${threadId}`),
  messages: (threadId: string) =>
    call<{ messages: Message[] }>(`/threads/${threadId}/messages`).then((r) => r.messages),
  scanSignals: (pid: string, categories: SignalCategory[]) =>
    call<ScanResult>(`/projects/${pid}/signals/scan`, json({ categories })),
  signals: (pid: string, q: { category?: string; status?: string; confidence_?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString();
    return call<{ signals: Signal[] }>(`/projects/${pid}/signals${qs ? `?${qs}` : ""}`).then((r) => r.signals);
  },
  signal: (id: string) => call<SignalDetail>(`/signals/${id}`),
  signalAction: (id: string, action: "dismiss" | "promote" | "restore" | "merge", body?: unknown) =>
    call<{ status: string }>(`/signals/${id}/${action}`, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) }),
  concepts: (pid: string) => call<{ concepts: ConceptRow[] }>(`/projects/${pid}/concepts`).then((r) => r.concepts),
  createConcept: (pid: string, title: string, signal_ids: string[]) =>
    call<{ id: string }>(`/projects/${pid}/concepts`, json({ title, signal_ids })),
  concept: (id: string) => call<ConceptDetail>(`/concepts/${id}`),
  saveSection: (id: string, key: string, body: string, base_version: number) =>
    call<{ version: number }>(`/concepts/${id}/sections/${key}`, { method: "PUT", body: JSON.stringify({ body, base_version }) }),
  score: (id: string, criterion: string, score: number) =>
    call<unknown>(`/concepts/${id}/scores`, { method: "PUT", body: JSON.stringify({ criterion, score }) }),
  conceptStatus: (id: string, status: string) =>
    call<unknown>(`/concepts/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) }),
  generateLenses: (id: string, departments?: string[]) =>
    call<Record<string, { status: string; statements: number }>>(`/concepts/${id}/lenses/generate`, json(departments ? { departments } : {})),
  lenses: (id: string) => call<Lenses>(`/concepts/${id}/lenses`),
  board: (pid: string) => call<Board>(`/projects/${pid}/pipeline`),
  gates: (id: string) => call<Gates>(`/concepts/${id}/gates`),
  decisions: (id: string) => call<{ decisions: Decision[] }>(`/concepts/${id}/decisions`).then((r) => r.decisions),
  decide: (id: string, action: string, reason: string, override = false) =>
    call<{ from: string; to: string }>(`/concepts/${id}/decisions`, json({ action, reason, override })),
  members: (pid: string) => call<Members>(`/projects/${pid}/members`),
  addMember: (pid: string, user_id: string, role: string) => call<unknown>(`/projects/${pid}/members`, json({ user_id, role })),
  setRole: (pid: string, uid: string, role: string) =>
    call<unknown>(`/projects/${pid}/members/${uid}`, { method: "PUT", body: JSON.stringify({ role }) }),
  removeMember: (pid: string, uid: string) => call<unknown>(`/projects/${pid}/members/${uid}`, { method: "DELETE" }),
  audit: (pid: string, q: { action?: string; before?: number } = {}) => {
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();
    return call<{ entries: AuditEntry[]; next_before: number | null }>(`/projects/${pid}/audit${qs ? `?${qs}` : ""}`);
  },
  usage: (pid: string) => call<Usage>(`/projects/${pid}/usage`),
  setBudget: (pid: string, monthly_call_budget: number | null) =>
    call<unknown>(`/projects/${pid}/budget`, { method: "PUT", body: JSON.stringify({ monthly_call_budget }) }),
  presence: (id: string) => call<{ users: PresenceUser[] }>(`/concepts/${id}/presence`).then((r) => r.users),
  heartbeat: (id: string, section: string | null) => call<unknown>(`/concepts/${id}/presence`, json({ section })),
  locks: (id: string) => call<{ locks: LockInfo[] }>(`/concepts/${id}/locks`).then((r) => r.locks),
  lock: (id: string, key: string) => call<unknown>(`/concepts/${id}/sections/${key}/lock`, { method: "POST" }),
  unlock: (id: string, key: string) => call<unknown>(`/concepts/${id}/sections/${key}/lock`, { method: "DELETE" }),
  comments: (id: string) => call<CommentsResp>(`/concepts/${id}/comments`),
  addComment: (id: string, body: string, stance: string, section: string | null, parent_id?: string) =>
    call<unknown>(`/concepts/${id}/comments`, json({ body, stance, section, parent_id: parent_id ?? null })),
  resolveComment: (cid: string, resolved: boolean) => call<unknown>(`/comments/${cid}/resolve`, json({ resolved })),
  ask: (threadId: string, question: string) => call<AskResult>(`/threads/${threadId}/ask`, json({ question })),
};
