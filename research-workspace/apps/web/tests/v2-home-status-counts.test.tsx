import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issues 4–7b, status / counts / loading:
 * - a finished run makes the work package Complete at 100% and its overview button "Run again"
 *   (the task row itself never changes: its status is the approval state);
 * - counts never read 0 while they are still loading, and the side lists never claim "No … yet"
 *   before their first response;
 * - the project overview never flashes "0 Work Packages / No work packages yet" while loading;
 * - the sidebar expands the work package the current route is about, not packages[0].
 */
const mockNav = vi.hoisted(() => ({ pathname: "/projects/p1", params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockNav.params,
  usePathname: () => mockNav.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ id: "p1" }),
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("next/image", () => ({ default: ({ alt }: { alt: string }) => <img alt={alt} /> }));
vi.mock("@/components/v2/projects/AttachmentGallery", () => ({ default: () => null }));
vi.mock("@/components/v2/projects/RefinementBar", () => ({ default: () => null }));
vi.mock("@/components/v2/projects/AssessmentCard", () => ({ default: () => null }));

const project = {
  id: "p1", slug: "dna-p1", name: "DNA heat study", mode: "open_discovery",
  meta: { objective: "Recover heat", priority: "High", charter: { type: "Technical", sponsor: "Director", departments: ["Engineering"] } },
};
const workTask: TaskRow = {
  id: "t1", title: "Pilot", status: "draft", created_at: "",
  brief: JSON.stringify({ objective: "Recover heat", approach: "Field test",
    workstream: { owner: "Sara", reviewer: "Ali", department: "Engineering", team: "Heat team", output: "Pilot report", start: "2027-01-10", due: "2027-03-01", dependencies: "Baseline" } }),
  code: "WP-1", lead_id: "Sara", due_date: "2027-03-01", stage: "Discovery", progress: 0, depends_on: ["Baseline"],
};
const secondTask: TaskRow = {
  id: "t2", title: "Costing", status: "draft", created_at: "",
  brief: JSON.stringify({ workstream: { owner: "Sara", department: "Engineering", output: "Cost model" } }),
  code: "WP-2", lead_id: "Sara", due_date: "2027-04-01", stage: "Discovery", progress: 0, depends_on: [],
};
const completeRun = {
  task_id: "t1", status: "complete", question: "q", statement: "Both models agree.", papers_read: 10,
  models: {}, error: null, references_added: false, started_at: "2026-11-28T10:00:00Z",
  finished_at: "2026-11-28T11:00:00Z", code: "WP-1", work_package_title: "Pilot",
  sources: { papers: 10, uploads: 0 },
};
const emptyLibrary = { summary: { total_sources: 0, claims_supported: 0, need_verification: 0 }, models: {}, runs: [], items: [] };
const libraryWith = (runs: unknown[]) => ({ ...emptyLibrary, runs });

vi.mock("@/lib/api", () => ({
  api: {
    projects: vi.fn(async () => [project]),
    chats: vi.fn(async () => []),
    sources: vi.fn(async () => []),
    tasks: vi.fn(async () => [workTask]),
    signals: vi.fn(async () => []),
    projectEvidence: vi.fn(async () => emptyLibrary),
    projectGates: vi.fn(async () => []),
    runTaskEvidence: vi.fn(async () => ({ task_id: "t1", status: "queued" })),
    taskProgress: vi.fn(async () => []),
    downloadWorkPackageDocument: vi.fn(async () => {}),
    downloadProjectDocument: vi.fn(async () => {}),
  },
  getToken: () => "t", setToken: () => {}, consumeTokenFragment: () => {}, ApiError: class extends Error {},
}));

import V2Frame from "@/components/v2/V2Frame";
import ProjectsPanel from "@/components/v2/dashboard/ProjectsPanel";
import HomePage from "@/app/(v2)/(app)/home/page";
import ProjectOverview from "@/components/v2/projects/ProjectOverview";
import WorkPackageOverview from "@/components/v2/projects/WorkPackageOverview";
import { api } from "@/lib/api";
import type { TaskRow } from "@/lib/types";

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  mockNav.pathname = "/projects/p1";
  mockNav.params = new URLSearchParams();
  vi.mocked(api.tasks).mockResolvedValue([workTask]);
  vi.mocked(api.projectEvidence).mockResolvedValue(emptyLibrary);
});

describe("Home side lists (issue 6d)", () => {
  it("says the chats and sources are loading, never 'No … yet', before the first response", async () => {
    const chats = deferred<never[]>();
    const sources = deferred<{ id: string; title: string }[]>();
    vi.mocked(api.chats).mockReturnValue(chats.promise as never);
    vi.mocked(api.sources).mockReturnValue(sources.promise as never);
    render(<V2Frame><HomePage /></V2Frame>);
    expect(await screen.findByText("Loading chats…")).toBeInTheDocument();
    expect(screen.getByText("Loading sources…")).toBeInTheDocument();
    expect(screen.queryByText(/No sources yet/)).not.toBeInTheDocument();
    expect(screen.queryByText("No chats in this project yet.")).not.toBeInTheDocument();
    chats.resolve([]);
    sources.resolve([{ id: "s1", title: "Heat paper" }]);
    expect(await screen.findByText("Heat paper")).toBeInTheDocument();
    expect(screen.queryByText(/No sources yet/)).not.toBeInTheDocument();
  });

  it("says the projects are loading, never 'No projects yet', before the first response", async () => {
    const projects = deferred<typeof project[]>();
    vi.mocked(api.projects).mockReturnValue(projects.promise as never);
    render(<V2Frame><HomePage /></V2Frame>);
    expect(await screen.findByText("Loading projects…")).toBeInTheDocument();
    expect(screen.queryByText("No projects yet.")).not.toBeInTheDocument();
    projects.resolve([project]);
    // The name shows in the project picker and in the "Your projects" list.
    expect((await screen.findAllByText("DNA heat study")).length).toBeGreaterThanOrEqual(1);
  });
});

describe("sidebar project count (issue 6a)", () => {
  it("shows '—' while the projects load, then the real count", async () => {
    const projects = deferred<typeof project[]>();
    vi.mocked(api.projects).mockReturnValue(projects.promise as never);
    render(<V2Frame><ProjectsPanel /></V2Frame>);
    expect(await screen.findByText("Total Projects")).toBeInTheDocument();
    expect(screen.getByText("Loading projects…")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    projects.resolve([project, { ...project, id: "p2", name: "Second" }]);
    await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument());
    expect(screen.queryByText("Loading projects…")).not.toBeInTheDocument();
  });

  it("expands the work package the /work-packages/ route is about, not the first one", async () => {
    mockNav.pathname = "/projects/p1/work-packages/t2";
    vi.mocked(api.tasks).mockResolvedValue([workTask, secondTask]);
    render(<V2Frame><WorkPackageOverview projectId="p1" taskId="t2" /></V2Frame>);
    await screen.findByRole("heading", { name: "Costing" });
    expect(screen.getByRole("link", { name: "Evidence" })).toHaveAttribute("href", "/projects/p1/evidence?work_package=t2");
    expect(screen.getByRole("link", { name: "Workspace" })).toHaveAttribute("href", "/projects/p1/workspace/t2");
  });
});

describe("project overview (issues 5 and 7b)", () => {
  it("never flashes '0 Work Packages / No work packages yet' while the tasks load", async () => {
    const tasks = deferred<typeof workTask[]>();
    vi.mocked(api.tasks).mockReturnValue(tasks.promise as never);
    render(<V2Frame><ProjectOverview id="p1" /></V2Frame>);
    expect(await screen.findByText("Loading work packages…")).toBeInTheDocument();
    expect(screen.queryByText("No work packages yet.")).not.toBeInTheDocument();
    tasks.resolve([workTask]);
    // "Pilot" is in the sidebar list and in the table.
    expect((await screen.findAllByText("Pilot")).length).toBeGreaterThanOrEqual(1);
  });

  it("shows Complete and 'Run again' for a work package whose research finished, and 'Loading…' while the runs load", async () => {
    const evidence = deferred<ReturnType<typeof libraryWith>>();
    vi.mocked(api.projectEvidence).mockReturnValue(evidence.promise as never);
    render(<V2Frame><ProjectOverview id="p1" /></V2Frame>);
    expect((await screen.findAllByText("Pilot")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "Loading…" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start research" })).not.toBeInTheDocument();
    evidence.resolve(libraryWith([completeRun]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Run again" })).toBeInTheDocument());
    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(screen.getByText("10 papers · 0 uploads")).toBeInTheDocument();
  });
});

describe("work package overview (issue 5)", () => {
  it("shows Complete at 100% with 'Run again' for a finished run, and 'Loading…' while the run loads", async () => {
    const evidence = deferred<ReturnType<typeof libraryWith>>();
    vi.mocked(api.projectEvidence).mockReturnValue(evidence.promise as never);
    render(<V2Frame><WorkPackageOverview projectId="p1" taskId="t1" /></V2Frame>);
    expect(await screen.findByRole("heading", { name: "Pilot" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Loading…" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start research" })).not.toBeInTheDocument();
    evidence.resolve(libraryWith([completeRun]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Run again" })).toBeInTheDocument());
    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("Status: complete")).toBeInTheDocument();
  });
});
