import { api } from "@/lib/api";
import type { AskResult, EvidenceScope } from "@/lib/types";

/** The design's "Evidence Sources" choices (same rules as the current site, see plan_evidence on the server). */
export const SCOPES: { value: EvidenceScope; label: string; hint: string }[] = [
  { value: "uploads", label: "My uploads", hint: "Only the PDFs uploaded to this project. Never searches online." },
  { value: "api", label: "Online", hint: "OpenAlex and Europe PMC papers, kept in this project." },
  { value: "both", label: "Uploads + online", hint: "Your uploads and online papers together." },
];

/* Per-browser conveniences: the last project and source choice. Storage can be blocked, so every access is guarded. */
const PREF = { project: "v2:ask:project", scope: "v2:ask:scope", lastRun: "v2:home:last-run" } as const;
const PENDING = "v2:ask:pending:";

function read(store: () => Storage, key: string): string | null {
  try { return store().getItem(key); } catch { return null; }
}
function write(store: () => Storage, key: string, value: string | null): void {
  try { value == null ? store().removeItem(key) : store().setItem(key, value); } catch { /* storage blocked */ }
}
const local = () => window.localStorage;
const session = () => window.sessionStorage;

export const prefs = {
  project: () => read(local, PREF.project),
  setProject: (id: string) => write(local, PREF.project, id),
  scope: (): EvidenceScope => {
    const s = read(local, PREF.scope);
    return SCOPES.some((x) => x.value === s) ? (s as EvidenceScope) : "both";
  },
  setScope: (s: EvidenceScope) => write(local, PREF.scope, s),
  /** The last research run Home showed (?running=<task>&project=<project>): Home keeps showing its final state
    on a plain visit, without the URL parameters. Cleared only by the browser. */
  lastRun: (): { project: string; task: string } | null => {
    try {
      const v = read(local, PREF.lastRun);
      const parsed = v ? JSON.parse(v) : null;
      return parsed && typeof parsed.project === "string" && typeof parsed.task === "string" ? parsed : null;
    } catch { return null; }
  },
  setLastRun: (project: string, task: string) => write(local, PREF.lastRun, JSON.stringify({ project, task })),
};

/** Home hands the first question to the chat page in this tab (never in the URL, which servers and history keep). */
export const pending = {
  put: (chatId: string, question: string, scope: EvidenceScope) =>
    write(session, PENDING + chatId, JSON.stringify({ question, scope })),
  take: (chatId: string): { question: string; scope: EvidenceScope } | null => {
    const raw = read(session, PENDING + chatId);
    write(session, PENDING + chatId, null);
    try {
      const v = raw ? JSON.parse(raw) : null;
      return v && typeof v.question === "string" && SCOPES.some((x) => x.value === v.scope) ? v : null;
    } catch { return null; }
  },
};

/**
 * Ask in a chat, reporting the server's live steps about every second.
 * When saved sources do not answer a follow-up, the server says so first ("not_in_saved_sources"); that note is shown
 * and the same question is asked again online, as the current site does.
 */
export async function runAsk(
  chatId: string, question: string, scope: EvidenceScope, onSteps: (steps: string[]) => void,
): Promise<AskResult> {
  let live = true;
  let told: string[] = [];
  void (async () => {
    let last = "";
    while (live) {
      try {
        const steps = await api.progress(chatId);
        const all = [...told, ...steps.filter((s) => !told.includes(s))];
        const key = JSON.stringify(all);
        if (live && key !== last) { last = key; onSteps(all); }
      } catch { /* progress is cosmetic: never fail the answer over it */ }
      await new Promise((r) => setTimeout(r, 1000));
    }
  })();
  try {
    const first = await api.askOpen(chatId, question, scope);
    if (first.kind !== "not_in_saved_sources") return first;
    told = [first.note];
    onSteps(told);
    const again = await api.askOpen(chatId, question, scope, "online");
    if (again.kind === "not_in_saved_sources") throw new Error(again.note);   // the server never repeats this; guard anyway
    return again;
  } finally {
    live = false;
  }
}
