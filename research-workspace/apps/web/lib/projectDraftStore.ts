/**
 * Per-browser autosave of the New Project wizard, so a refresh does not lose the charter.
 * Storage can be blocked or full (private windows), so every access is wrapped and optional.
 */
export const PROJECT_DRAFT_KEY = "newProject:draft:v1";

export type StoredProjectDraft = {
  v: 1;
  phase: "prompt" | "chat" | "setup";
  prompt: string;
  files: string[];
  draft: unknown;
  section: number;
  messages: { from: "ai" | "user"; text: string }[];
  questions: unknown[];
  asked: string[];
  suggested: string[];
  round: number;
};

export function readProjectDraft(): StoredProjectDraft | null {
  try {
    const raw = window.localStorage.getItem(PROJECT_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredProjectDraft;
    return parsed && parsed.v === 1 && parsed.draft && typeof parsed.draft === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeProjectDraft(value: StoredProjectDraft): void {
  try {
    window.localStorage.setItem(PROJECT_DRAFT_KEY, JSON.stringify(value));
  } catch {
    /* storage unavailable or full: the wizard still works, it just will not resume */
  }
}

export function clearProjectDraft(): void {
  try {
    window.localStorage.removeItem(PROJECT_DRAFT_KEY);
  } catch {
    /* nothing to clear */
  }
}
