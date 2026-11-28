import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DecisionGate, TaskRow } from "@/lib/types";

/**
 * Run / Run again / Start research / Retry always opens the Home tab after the
 * run has started on the server. Home itself is untouched: no card, no polling.
 * A failed start stays on the page and shows the error instead.
 */
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/projects/p1",
  useRouter: () => ({ push, replace: vi.fn() }),
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
  brief: JSON.stringify({
    objective: "Recover heat", approach: "Field test",
    workstream: { owner: "Sara", reviewer: "Ali", department: "Engineering", team: "Heat team", output: "Pilot report", start: "2027-01-10", due: "2027-03-01", dependencies: "Baseline" },
  }),
  code: "WP-1", lead_id: "Sara", due_date: "2027-03-01", stage: "Discovery", progress: 20, depends_on: ["Baseline"],
};
const gate: DecisionGate = {
  id: "g1", gate_name: "Gate 1", target_date: "2027-03-15", decision_owner: "Sara", approver: "Director",
  acceptance_criteria: "Payback under 3 years", gate_scope: "Pilot", status: "Pending", decided_at: null,
};
const evidenceRun = {
  task_id: "t1", status: "complete", question: "q", statement: null, papers_read: 10,
  models: {}, error: null, references_added: false, started_at: "", finished_at: "",
  code: "WP-1", work_package_title: "Pilot", sources: { papers: 12, uploads: 0 },
};

vi.mock("@/lib/api", () => ({
  api: {
    projects: vi.fn(async () => [project]),
    tasks: vi.fn(async () => [workTask]),
    sources: vi.fn(async () => []),
    signals: vi.fn(async () => []),
    projectEvidence: vi.fn(async () => ({ summary: {}, models: {}, runs: [evidenceRun], items: [] })),
    projectGates: vi.fn(async () => [gate]),
    setGateStatus: vi.fn(async () => ({ id: "g1", gate_name: "Gate 1", status: "Approved", decided_at: null })),
    updateWorkPackage: vi.fn(async () => ({ code: "WP-1", lead_id: "Sara", due_date: null, stage: "Validation", progress: 100 })),
    createWorkPackage: vi.fn(async () => ({ id: "t9", code: "WP-3", title: "Battery tests" })),
    runTaskEvidence: vi.fn(async () => ({ task_id: "t1", status: "queued" })),
  },
  getToken: () => "t", setToken: () => {}, consumeTokenFragment: () => {}, ApiError: class extends Error {},
}));

import V2Frame from "@/components/v2/V2Frame";
import ProjectOverview from "@/components/v2/projects/ProjectOverview";
import WorkPackageOverview from "@/components/v2/projects/WorkPackageOverview";
import { api } from "@/lib/api";

beforeEach(() => { vi.clearAllMocks(); });

describe("Run opens the Home tab", () => {
  it("Project Overview: Run again starts the run, then opens Home", async () => {
    render(<V2Frame><ProjectOverview id="p1" /></V2Frame>);
    fireEvent.click(await screen.findByRole("button", { name: "Run again" }));
    await waitFor(() => expect(api.runTaskEvidence).toHaveBeenCalledWith("t1"));
    expect(push).toHaveBeenCalledWith("/home");
  });

  it("Project Overview: a failed start stays on the page and shows the error", async () => {
    vi.mocked(api.runTaskEvidence).mockRejectedValueOnce(new Error("The models are busy."));
    render(<V2Frame><ProjectOverview id="p1" /></V2Frame>);
    fireEvent.click(await screen.findByRole("button", { name: "Run again" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The models are busy.");
    expect(push).not.toHaveBeenCalled();
  });

  it("Work Package Overview: Run again starts the run, then opens Home", async () => {
    render(<V2Frame><WorkPackageOverview projectId="p1" taskId="t1" /></V2Frame>);
    fireEvent.click(await screen.findByRole("button", { name: "Run again" }));
    await waitFor(() => expect(api.runTaskEvidence).toHaveBeenCalledWith("t1"));
    expect(push).toHaveBeenCalledWith("/home");
  });
});
