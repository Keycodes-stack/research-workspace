import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/projects/p1",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ id: "p1" }),
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("next/image", () => ({ default: ({ alt }: { alt: string }) => <img alt={alt} /> }));
// Components that load their own data are not under test here.
vi.mock("@/components/v2/projects/AttachmentGallery", () => ({ default: () => null }));
vi.mock("@/components/v2/projects/RefinementBar", () => ({ default: () => null }));
vi.mock("@/components/v2/projects/AssessmentCard", () => ({ default: () => null }));

vi.mock("@/lib/api", () => ({
  api: {
    projects: vi.fn(async () => [project]),
    tasks: vi.fn(async () => [workTask]),
    sources: vi.fn(async () => []),
    signals: vi.fn(async () => []),
    projectEvidence: vi.fn(async () => ({ summary: {}, models: {}, runs: [], items: [] })),
    projectGates: vi.fn(async () => [gate]),
    setGateStatus: vi.fn(async () => ({ id: "g1", gate_name: "Gate 1", status: "Approved", decided_at: null })),
    updateWorkPackage: vi.fn(async () => ({ code: "WP-1", lead_id: "Sara", due_date: null, stage: "Validation", progress: 100 })),
    createWorkPackage: vi.fn(async () => ({ id: "t9", code: "WP-3", title: "Battery tests" })),
    runTaskEvidence: vi.fn(async () => ({ task_id: "t1", status: "queued" })),
  },
  getToken: () => "t", setToken: () => {}, consumeTokenFragment: () => {}, ApiError: class extends Error {},
}));

import V2Frame from "@/components/v2/V2Frame";
import NewWorkPackage from "@/components/v2/projects/NewWorkPackage";
import ProjectOverview from "@/components/v2/projects/ProjectOverview";
import WorkPackageOverview from "@/components/v2/projects/WorkPackageOverview";
import { api } from "@/lib/api";
import { workPackage } from "@/lib/workPackages";
import type { DecisionGate, TaskRow } from "@/lib/types";

const project = {
  id: "p1", slug: "dna-p1", name: "DNA heat study", mode: "open_discovery",
  meta: { objective: "Recover heat", priority: "High", charter: { type: "Technical", sponsor: "Director", departments: ["Engineering"] } },
};

/** A work package created by the wizard: its workstream fields live in the brief JSON. */
const workTask: TaskRow = {
  id: "t1", title: "Pilot", status: "draft", created_at: "",
  brief: JSON.stringify({
    objective: "Recover heat", approach: "Field test",
    workstream: { owner: "Sara", reviewer: "Ali", department: "Engineering", team: "Heat team", output: "Pilot report", start: "2027-01-10", due: "2027-03-01", dependencies: "Baseline" },
  }),
  code: "WP-1", lead_id: "Sara", due_date: "2027-03-01", stage: "Discovery", progress: 20, depends_on: ["Baseline"],
};

/** A package typed by hand in "+ New work package": no workstream and no work package row. */
const legacyTask: TaskRow = { id: "t2", title: "Typed", brief: "Compare cells", status: "draft", created_at: "", code: null };

const gate: DecisionGate = {
  id: "g1", gate_name: "Gate 1", target_date: "2027-03-15", decision_owner: "Sara", approver: "Director",
  acceptance_criteria: "Payback under 3 years", gate_scope: "Pilot", status: "Pending", decided_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  // The sidebar also lists the project's work packages, so every call returns both.
  vi.mocked(api.tasks).mockResolvedValue([workTask, legacyTask]);
});

describe("work package parsing", () => {
  it("reads the workstream fields, dependencies and the work package row", () => {
    const wp = workPackage(workTask);
    expect(wp).toMatchObject({ code: "WP-1", owner: "Sara", reviewer: "Ali", team: "Heat team", output: "Pilot report", due: "2027-03-01", dependsOn: ["Baseline"], progress: 20, stage: "Discovery" });
    expect(wp.objective).toBe("Recover heat");
  });

  it("keeps a plain-text brief as the description, and copes with no work package row", () => {
    const wp = workPackage(legacyTask);
    expect(wp.brief).toBe("Compare cells");
    expect(wp.owner).toBe("Not assigned");
    expect(wp.code).toBeNull();
    expect(wp.dependsOn).toEqual([]);
  });
});

describe("work package overview", () => {
  it("shows the package's own details, its dependencies and the gates that cover it", async () => {
    render(<V2Frame><WorkPackageOverview projectId="p1" taskId="t1" /></V2Frame>);
    expect(await screen.findByRole("heading", { name: "Pilot" })).toBeInTheDocument();
    expect(screen.getByText("WP-1 · DNA heat study")).toBeInTheDocument();
    expect(screen.getByText("Baseline")).toBeInTheDocument();                       // depends on
    expect(await screen.findByText("Gate 1")).toBeInTheDocument();                  // gate scope names this package
    expect(screen.getByRole("heading", { name: "Stage and progress" })).toBeInTheDocument();
  });

  it("saves the stage and progress entered", async () => {
    render(<V2Frame><WorkPackageOverview projectId="p1" taskId="t1" /></V2Frame>);
    await screen.findByRole("heading", { name: "Pilot" });
    fireEvent.change(screen.getByLabelText(/^Stage/), { target: { value: "Validation" } });
    fireEvent.change(screen.getByLabelText(/Progress/), { target: { value: "65" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(api.updateWorkPackage).toHaveBeenCalledWith("t1", { stage: "Validation", progress: 65 }));
  });

  it("hides the stage form for a package with no work package row, since it cannot be saved", async () => {
    render(<V2Frame><WorkPackageOverview projectId="p1" taskId="t2" /></V2Frame>);
    expect(await screen.findByRole("heading", { name: "Typed" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Stage and progress" })).toBeNull();
  });
});

describe("starting research", () => {
  it("disables Start research as soon as it is pressed, so one click starts one run", async () => {
    let finish!: () => void;
    vi.mocked(api.runTaskEvidence).mockImplementationOnce(() => new Promise((resolve) => {
      finish = () => resolve({ task_id: "t1", status: "queued" });
    }));
    render(<V2Frame><WorkPackageOverview projectId="p1" taskId="t1" /></V2Frame>);
    fireEvent.click(await screen.findByRole("button", { name: "Start research" }));
    const starting = await screen.findByRole("button", { name: "Starting…" });
    expect(starting).toBeDisabled();
    fireEvent.click(starting);                       // a second press does nothing while it is disabled
    finish();
    await vi.waitFor(() => expect(api.runTaskEvidence).toHaveBeenCalledTimes(1));
  });
});

describe("decision gate status on the project overview", () => {
  it("shows the stored gates and saves a status change", async () => {
    render(<V2Frame><ProjectOverview id="p1" /></V2Frame>);
    expect(await screen.findByText("Gate 1")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Status/), { target: { value: "Approved" } });
    await vi.waitFor(() => expect(api.setGateStatus).toHaveBeenCalledWith("p1", "g1", "Approved"));
  });

  it("says so when the status cannot be saved", async () => {
    vi.mocked(api.setGateStatus).mockRejectedValueOnce(new Error("Only a lead scientist can decide a gate."));
    render(<V2Frame><ProjectOverview id="p1" /></V2Frame>);
    fireEvent.change(await screen.findByLabelText(/^Status/), { target: { value: "Approved" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Only a lead scientist can decide a gate.");
  });
});

describe("new work package form", () => {
  it("sends the lead and due date with the title and brief", async () => {
    const user = userEvent.setup();
    render(<NewWorkPackage projectId="p1" onCreated={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "+ New work package" }));
    const form = screen.getByRole("form", { name: "New work package" });
    await user.type(within(form).getByLabelText("Title"), "Battery tests");
    await user.type(within(form).getByLabelText(/Lead/), "Sara");
    fireEvent.change(within(form).getByLabelText(/Due date/), { target: { value: "2027-03-01" } });
    await user.click(within(form).getByRole("button", { name: "Create work package" }));
    expect(api.createWorkPackage).toHaveBeenCalledWith("p1", { title: "Battery tests", brief: undefined, lead: "Sara", due: "2027-03-01" });
  });
});
