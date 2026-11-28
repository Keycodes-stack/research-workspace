import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvidenceLibrary as Library } from "@/lib/types";

/**
 * The Home run card: a Run / Run again click lands here with ?running= and
 * ?project=, and Home shows that project's research in progress — its own
 * project id, never the Ask project list (which is open-discovery only).
 * No progress % exists anywhere, so a running row shows status only.
 */
const mockSearch = vi.hoisted(() => ({ params: new URLSearchParams() }));
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearch.params,
  usePathname: () => "/home",
  useRouter: () => ({ push, replace: vi.fn() }),
  useParams: () => ({ id: "p1" }),
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("next/image", () => ({ default: ({ alt }: { alt: string }) => <img alt={alt} /> }));

const projects = [
  { id: "p1", name: "DNA heat study", mode: "open_discovery", meta: {} },
  { id: "p2", name: "Locked repository", mode: "closed_repository", meta: {} },
];
const run = (over: Partial<Library["runs"][number]>): Library["runs"][number] => ({
  task_id: "t1", status: "running", question: "q", statement: null, papers_read: 0,
  models: {}, error: null, references_added: false, started_at: "2026-11-28T10:00:00Z", finished_at: null,
  code: "WP-1", work_package_title: "Pilot", sources: { papers: 0, uploads: 0 }, ...over,
});
const libraryFor = (runs: Library["runs"]): Library => ({
  summary: { total_sources: 0, claims_supported: 0, need_verification: 0 }, models: {}, runs, items: [],
});
const projectEvidence = vi.fn(async (pid: string): Promise<Library> =>
  pid === "p2" ? libraryFor([run({ task_id: "t9", code: "WP-9", work_package_title: "Locked work" })]) : libraryFor([]),
);
const runTaskEvidence = vi.fn(async (tid: string) => ({ task_id: tid, status: "queued" }));
const taskProgress = vi.fn(async (tid: string): Promise<string[]> => [
  "Reading the project and the work package...",
  "Two models are reading 10 papers...",
]);

vi.mock("@/lib/api", () => ({
  api: {
    projects: vi.fn(async () => projects),
    chats: vi.fn(async () => []),
    sources: vi.fn(async () => []),
    projectEvidence: (pid: string) => projectEvidence(pid),
    runTaskEvidence: (tid: string) => runTaskEvidence(tid),
    taskProgress: (tid: string) => taskProgress(tid),
  },
  getToken: () => "t", setToken: () => {}, consumeTokenFragment: () => {}, ApiError: class extends Error {},
}));

import V2Frame from "@/components/v2/V2Frame";
import HomePage from "@/app/(v2)/(app)/home/page";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockSearch.params = new URLSearchParams();
  projectEvidence.mockImplementation(async (pid: string) =>
    pid === "p2" ? libraryFor([run({ task_id: "t9", code: "WP-9", work_package_title: "Locked work" })]) : libraryFor([]),
  );
  taskProgress.mockImplementation(async () => [
    "Reading the project and the work package...",
    "Two models are reading 10 papers...",
  ]);
});

describe("Home run status card", () => {
  it("shows the running and queued runs for the run's project and highlights the just-started run", async () => {
    mockSearch.params = new URLSearchParams("running=t1&project=p1");
    projectEvidence.mockResolvedValueOnce(libraryFor([
      run({ task_id: "t1", status: "running" }),
      run({ task_id: "t2", status: "queued", code: "WP-2", work_package_title: "Second" }),
    ]));
    render(<V2Frame><HomePage /></V2Frame>);
    expect(await screen.findByRole("heading", { name: "Research running" })).toBeInTheDocument();
    expect(screen.getByText("WP-1 · Pilot")).toBeInTheDocument();
    expect(screen.getByText("Researching…")).toBeInTheDocument();
    expect(screen.getByText("WP-2 · Second")).toBeInTheDocument();
    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(screen.getByText(/just started/)).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: "View evidence →" });
    expect(links[0]).toHaveAttribute("href", "/projects/p1/evidence?work_package=t1");
    expect(links[1]).toHaveAttribute("href", "/projects/p1/evidence?work_package=t2");
    expect(projectEvidence).toHaveBeenCalledWith("p1");
  });

  it("shows a completed run with its statement and papers read", async () => {
    mockSearch.params = new URLSearchParams("running=t1&project=p1");
    projectEvidence.mockResolvedValueOnce(libraryFor([
      run({ task_id: "t1", status: "complete", statement: "Both models agree on the main claim.", papers_read: 10, finished_at: "2026-11-28T11:00:00Z" }),
    ]));
    render(<V2Frame><HomePage /></V2Frame>);
    expect(await screen.findByText("Complete")).toBeInTheDocument();
    expect(screen.getByText(/10 papers read · Both models agree on the main claim\./)).toBeInTheDocument();
  });

  it("says 'Research complete' with a finished time for a completed run, never 'running' or 'just started'", async () => {
    mockSearch.params = new URLSearchParams("running=t1&project=p1");
    projectEvidence.mockResolvedValueOnce(libraryFor([
      run({ task_id: "t1", status: "complete", statement: "Done.", papers_read: 10, finished_at: "2026-11-28T11:00:00Z" }),
    ]));
    render(<V2Frame><HomePage /></V2Frame>);
    expect(await screen.findByRole("heading", { name: "Research complete" })).toBeInTheDocument();
    expect(screen.getByText(/finished/)).toBeInTheDocument();
    expect(screen.queryByText(/just started/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Research running" })).not.toBeInTheDocument();
  });

  it("keeps showing the last run on a plain Home visit, without the URL parameters", async () => {
    localStorage.setItem("v2:home:last-run", JSON.stringify({ project: "p1", task: "t1" }));
    projectEvidence.mockResolvedValueOnce(libraryFor([
      run({ task_id: "t1", status: "complete", statement: "Done.", papers_read: 10, finished_at: "2026-11-28T11:00:00Z" }),
    ]));
    render(<V2Frame><HomePage /></V2Frame>);
    expect(await screen.findByRole("heading", { name: "Research complete" })).toBeInTheDocument();
    expect(screen.getByText("WP-1 · Pilot")).toBeInTheDocument();
    expect(projectEvidence).toHaveBeenCalledWith("p1");
  });

  it("remembers the run a Run click lands with, so the next plain visit still shows it", async () => {
    mockSearch.params = new URLSearchParams("running=t1&project=p1");
    projectEvidence.mockResolvedValueOnce(libraryFor([
      run({ task_id: "t1", status: "running" }),
    ]));
    render(<V2Frame><HomePage /></V2Frame>);
    await screen.findByRole("heading", { name: "Research running" });
    expect(localStorage.getItem("v2:home:last-run")).toBe(JSON.stringify({ project: "p1", task: "t1" }));
  });

  it("shows a failed run with its error and retries it", async () => {
    mockSearch.params = new URLSearchParams("running=t1&project=p1");
    projectEvidence.mockResolvedValueOnce(libraryFor([
      run({ task_id: "t1", status: "failed", error: "The models timed out." }),
    ]));
    render(<V2Frame><HomePage /></V2Frame>);
    expect(await screen.findByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("The models timed out.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(runTaskEvidence).toHaveBeenCalledWith("t1"));
  });

  it("loads the run's project even when it is not the Ask project", async () => {
    mockSearch.params = new URLSearchParams("running=t9&project=p2");
    render(<V2Frame><HomePage /></V2Frame>);
    expect(await screen.findByText("WP-9 · Locked work")).toBeInTheDocument();
    expect(projectEvidence).toHaveBeenCalledWith("p2");
  });

  it("shows the latest live step under a running row and polls for it while running", async () => {
    mockSearch.params = new URLSearchParams("running=t1&project=p1");
    projectEvidence.mockResolvedValueOnce(libraryFor([
      run({ task_id: "t1", status: "running" }),
    ]));
    render(<V2Frame><HomePage /></V2Frame>);
    expect(await screen.findByText("Two models are reading 10 papers...")).toBeInTheDocument();
    expect(taskProgress).toHaveBeenCalledWith("t1");
  });

  it("does not poll for live steps once the run is complete", async () => {
    mockSearch.params = new URLSearchParams("running=t1&project=p1");
    projectEvidence.mockResolvedValueOnce(libraryFor([
      run({ task_id: "t1", status: "complete", statement: "Done.", papers_read: 10, finished_at: "2026-11-28T11:00:00Z" }),
    ]));
    render(<V2Frame><HomePage /></V2Frame>);
    expect(await screen.findByText("Complete")).toBeInTheDocument();
    expect(screen.getByText(/10 papers read · Done\./)).toBeInTheDocument();
    expect(taskProgress).not.toHaveBeenCalled();
  });

  it("shows no card when no run parameters are present", async () => {
    render(<V2Frame><HomePage /></V2Frame>);
    await screen.findByText("Your projects");
    expect(screen.queryByRole("heading", { name: "Research running" })).not.toBeInTheDocument();
    expect(projectEvidence).not.toHaveBeenCalled();
  });
});
