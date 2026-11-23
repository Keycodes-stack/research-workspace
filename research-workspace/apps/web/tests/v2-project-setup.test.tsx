import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }));

vi.mock("@/lib/api", () => ({
  api: {
    projects: vi.fn(async () => []),
    tasks: vi.fn(async () => []),
    projectIntake: vi.fn(),
    projectInsights: vi.fn(),
    createProjectComplete: vi.fn(),
    people: vi.fn(async () => []),
    createPerson: vi.fn(),
  },
  getToken: () => "t", setToken: () => {}, consumeTokenFragment: () => {}, ApiError: class extends Error {},
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/projects/new", useRouter: () => ({ push: () => {} }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("next/image", () => ({ default: ({ alt }: { alt: string }) => <img alt={alt} /> }));

import V2Frame from "@/components/v2/V2Frame";
import NewProjectFlow from "@/components/v2/projects/NewProjectFlow";
import { api } from "@/lib/api";
import { asInsights, EMPTY_PROJECT_DRAFT, type ProjectInsights } from "@/lib/projectIntake";
import { PROJECT_DRAFT_KEY, readProjectDraft, writeProjectDraft } from "@/lib/projectDraftStore";

const insights: ProjectInsights = {
  summary: "Heat recovery looks technically viable.", recommendation: "Run a single-site pilot first.",
  feasibility: 72, stats: [{ label: "Feasibility Score", value: "72%" }],
  risks: [{ risk: "Supplier delay", likelihood: "High", impact: "Medium", mitigation: "Dual source", owner: "Ops" }],
  questions: ["What is the payback at Plant A?"], nextSteps: ["Survey Plant A heat streams"],
  model: "model-a", generatedAt: "2026-11-22T00:00:00Z",
};

/** A draft that passes every review check, so "Create project" is enabled. */
const readyDraft = {
  ...EMPTY_PROJECT_DRAFT,
  name: "Heat recovery", type: "Technical Feasibility", objective: "Recover waste heat at Plant A", lead: "Sara", sponsor: "Director",
  departments: ["Engineering"], team_mode: "Department leads assign their teams later",
  workstreams: [{ name: "Pilot", department: "", team: "", output: "Pilot report", owner: "Sara", reviewer: "", start: "", due: "", dependencies: "" }],
  gates: [{ name: "Gate 1", owner: "Sara", approver: "Director", date: "", criteria: "Payback under 3 years", workstreams: ["Pilot"] }],
  risks: [{ risk: "Delay", owner: "Ops", severity: "Medium", response: "Buffer" }],
};

function seedDraft(overrides: Partial<{ phase: "prompt" | "chat" | "setup"; section: number }> = {}) {
  writeProjectDraft({
    v: 1, phase: overrides.phase ?? "setup", prompt: "", files: [], draft: readyDraft,
    section: overrides.section ?? 0, messages: [], questions: [], asked: [], suggested: [], round: 0,
  });
}

const renderFlow = () => render(<V2Frame><NewProjectFlow /></V2Frame>);

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("project draft storage", () => {
  it("round-trips a saved draft and ignores corrupt data", () => {
    seedDraft();
    expect(readProjectDraft()?.draft).toMatchObject({ name: "Heat recovery" });
    window.localStorage.setItem(PROJECT_DRAFT_KEY, "{not json");
    expect(readProjectDraft()).toBeNull();
    window.localStorage.setItem(PROJECT_DRAFT_KEY, JSON.stringify({ v: 2, draft: {} }));
    expect(readProjectDraft()).toBeNull();
  });

  it("does not throw when browser storage is blocked", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(() => writeProjectDraft({ v: 1, phase: "prompt", prompt: "x", files: [], draft: {}, section: 0, messages: [], questions: [], asked: [], suggested: [], round: 0 })).not.toThrow();
    spy.mockRestore();
  });
});

describe("assessment guard", () => {
  it("accepts a well-formed assessment and rejects anything else", () => {
    expect(asInsights(insights)).toMatchObject({ feasibility: 72, summary: insights.summary });
    expect(asInsights(undefined)).toBeNull();
    expect(asInsights({ summary: "x" })).toBeNull();
    expect(asInsights("text")).toBeNull();
  });
});

describe("AI-assisted project creation", () => {
  it("resumes a saved draft after a refresh", async () => {
    seedDraft({ section: 0 });
    renderFlow();
    expect(await screen.findByLabelText("Project name")).toHaveValue("Heat recovery");
  });

  it("saves the assessment with the reviewed charter and shows it on the created screen", async () => {
    vi.mocked(api.projectInsights).mockResolvedValueOnce(insights);
    vi.mocked(api.createProjectComplete).mockResolvedValueOnce({ id: "abcdef12-0000", work_packages: [] } as never);
    seedDraft({ section: 4 });
    renderFlow();

    fireEvent.click(await screen.findByRole("button", { name: "Create project" }));

    expect(await screen.findByRole("heading", { name: "Project successfully initialized!" })).toBeInTheDocument();
    expect(api.projectInsights).toHaveBeenCalledWith(expect.objectContaining({ name: "Heat recovery" }));
    expect(api.createProjectComplete).toHaveBeenCalledWith(expect.objectContaining({
      name: "Heat recovery", insights, work_packages: [expect.objectContaining({ title: "Pilot" })],
    }), undefined);
    expect(screen.getByRole("region", { name: "AI assessment" })).toHaveTextContent("Feasibility 72%");
    expect(screen.getByText("What is the payback at Plant A?")).toBeInTheDocument();
    expect(readProjectDraft()).toBeNull();
  });

  it("still creates the project when the assessment fails, and says so", async () => {
    vi.mocked(api.projectInsights).mockRejectedValueOnce(new Error("model down"));
    vi.mocked(api.createProjectComplete).mockResolvedValueOnce({ id: "abcdef12-0000", work_packages: [] } as never);
    seedDraft({ section: 4 });
    renderFlow();

    fireEvent.click(await screen.findByRole("button", { name: "Create project" }));

    expect(await screen.findByRole("heading", { name: "Project successfully initialized!" })).toBeInTheDocument();
    expect(api.createProjectComplete).toHaveBeenCalledWith(expect.objectContaining({ insights: undefined }), undefined);
    expect(screen.getAllByRole("status").some((el) => /could not be generated/.test(el.textContent ?? ""))).toBe(true);
  });

  it("discards the saved draft and returns to the idea prompt", async () => {
    seedDraft({ section: 0 });
    renderFlow();
    fireEvent.click(await screen.findByRole("button", { name: "Discard draft" }));
    expect(await screen.findByLabelText("Project idea")).toHaveValue("");
    expect(window.localStorage.getItem(PROJECT_DRAFT_KEY)).toBeNull();
  });

  it("hides dictation where the browser has no speech recognition", async () => {
    renderFlow();
    await screen.findByLabelText("Project idea");
    expect(screen.queryByRole("button", { name: "Speak your idea" })).toBeNull();
    expect(screen.getByText(/PDFs and images are added to the project/)).toBeInTheDocument();
  });
});
