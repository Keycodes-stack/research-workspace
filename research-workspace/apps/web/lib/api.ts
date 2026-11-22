import type {
  AskResult, AuditEntry, ChatRow, EvidenceScope, NotInSavedSources, CommentsResp, LockInfo, PresenceUser, Board, ConceptDetail, Decision, Gates, ConceptRow, Lenses, Members, Message, Mode, Project, ScanResult, Signal, SignalCategory, SignalDetail, SourceRow, TaskDetail, TaskRow, Usage,
} from "./types";
import type { IntakeResponse, ProjectDraft } from "./projectIntake";

if (!process.env.NEXT_PUBLIC_API_URL) {
  throw new Error("NEXT_PUBLIC_API_URL is not set. Add it to .env.local before running the app.");
}
// All browser→API traffic goes through the Next.js proxy (/api/backend/*  →  NEXT_PUBLIC_API_URL).
// This avoids CORS entirely: the proxy runs server-side, so the browser only ever talks to its own origin.
export const API_URL = "/api/backend";
/** The static Halden page can't read env vars, so it gets the proxy path in its URL (read by halden-bridge.js). */
export const HALDEN_SRC = `/halden.html?api=${encodeURIComponent(API_URL)}`;
const TOKEN_KEY = "kc_token";

// In-memory copy: when the browser cannot save (disk full, private mode, storage blocked) the user stays signed
// in for this visit instead of being bounced back to the sign-in form. The Halden frame reads it as parent.__kcToken.
let memoryToken: string | null = null;

export function getToken(): string | null {
  try { return window.localStorage.getItem(TOKEN_KEY) ?? memoryToken; } catch { return memoryToken; }
}
export function setToken(t: string | null): void {
  memoryToken = t;
  try { (window as unknown as { __kcToken?: string | null }).__kcToken = t; } catch { /* no window */ }
  try { t ? window.localStorage.setItem(TOKEN_KEY, t) : window.localStorage.removeItem(TOKEN_KEY); } catch { /* storage full or blocked */ }
}

/** Dev/launcher sign-in: a `#kc_token=...` URL fragment is stored, then removed from the address bar. */
export function consumeTokenFragment(): void {
  try {
    const m = /[#&]kc_token=([^&]+)/.exec(window.location.hash);
    if (!m) return;
    setToken(decodeURIComponent(m[1]));
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  } catch { /* no window or storage blocked */ }
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

/** Every failed call is logged once, in one format, with the layer that failed (see public/halden-errors.js). */
function fail(method: string, path: string, status: number, body: unknown): ApiError {
  const detail = body && typeof body === "object" && "detail" in (body as object) ? (body as { detail: unknown }).detail : body;
  const err = new ApiError(status, detail, status === 0 ? "Cannot reach the server. Check that the gateway is running." : describe(body, status));
  const e = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  const info = e && typeof e === "object" ? (e as Record<string, unknown>) : {};
  const layer = status === 0 ? "network" : typeof e === "object" ? "ai" : typeof e === "string" ? "gateway" : status >= 500 ? "proxy" : "ai";
  console.error(`✖ ${method} ${path}: ${err.message}`, {
    status, code: info.code ?? err.code ?? `http_${status}`, layer, failedAt: info.where, requestId: info.request_id,
  });
  return err;
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
    throw fail(init.method ?? "GET", path, 0, null);
  }
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw fail(init.method ?? "GET", path, res.status, body);
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
  catch { throw fail("POST", path, 0, null); }
  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* not json */ }
    throw fail("POST", path, res.status, parsed);
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
  projectIntake: (body: {
    mode: "start" | "answer" | "finish" | "edit";
    text: string;
    draft: Partial<ProjectDraft>;
    asked: string[];
    history: { from: "ai" | "user"; text: string }[];
    round: number;
  }) => call<IntakeResponse>("/projects/intake", json(body)),
  createProjectComplete: (body: {
    name: string;
    mode: Mode;
    meta: Record<string, string>;
    charter: ProjectDraft;
    work_packages: { title: string; brief: string }[];
  }) => call<Project & { work_packages: { id: string; title: string }[] }>("/projects/complete", json(body)),
  sources: (pid: string) => call<{ sources: SourceRow[] }>(`/projects/${pid}/sources`).then((r) => r.sources),
  upload: (pid: string, file: File) => {
    const f = new FormData();
    f.append("file", file);
    return call<{ source_id: string; chunks?: number }>(`/projects/${pid}/sources/upload`, { method: "POST", body: f });
  },
  discover: (pid: string, question: string, topN = 20, force = false) =>
    call<{ sources: { title?: string; status?: string }[]; dropped: unknown[]; errors: string[]; skipped?: boolean; existing_sources?: number; reason?: string }>(
      `/projects/${pid}/discover-and-ingest`, json({ question, top_n: topN, force })),
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
  /** Open-discovery ask: the server picks the sources from the scope and the chat's history. */
  askOpen: (threadId: string, question: string, scope: EvidenceScope, evidence: "auto" | "online" = "auto") =>
    call<AskResult | NotInSavedSources>(`/threads/${threadId}/ask`,
      json({ question, scope, online: scope !== "uploads", evidence })),
  progress: (threadId: string) => call<{ steps: string[] }>(`/threads/${threadId}/progress`).then((r) => r.steps),
  chats: (pid: string) => call<{ chats: ChatRow[] }>(`/projects/${pid}/chats`).then((r) => r.chats),
  createChat: (pid: string, title: string) => call<{ id: string; title: string }>(`/projects/${pid}/chats`, json({ title })),
};
