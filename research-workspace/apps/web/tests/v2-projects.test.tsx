import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const projects = [
  { id: "p1", slug: "mrna-vaccine-stability-p1", code: "P-001", name: "mRNA Vaccine Stability", mode: "open_discovery", status: "In Progress",
    governance_stage: "Validation", project_lead: "Sarah Chen", work_packages: 2, progress: 42, meta: { lead: "Sarah Chen" } },
  { id: "p2", slug: "perovskite-degradation-p2", code: "P-002", name: "Perovskite Degradation", mode: "open_discovery", status: "Draft",
    governance_stage: "Discovery", project_lead: null, work_packages: 0, progress: null, meta: {} },
];

vi.mock("@/lib/api", () => ({
  api: {
    projects: vi.fn(async () => projects),
    tasks: vi.fn(async (id: string) => {
      if (id === "p2") throw new Error("tasks unavailable");
      return [{ id: "t1" }, { id: "t2" }];
    }),
  },
  getToken: () => "t", setToken: () => {}, consumeTokenFragment: () => {}, ApiError: class extends Error {},
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/projects" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("next/image", () => ({ default: ({ alt }: { alt: string }) => <img alt={alt} /> }));

import V2Frame from "@/components/v2/V2Frame";
import ProjectsPage from "@/app/(v2)/(app)/projects/page";
import { api } from "@/lib/api";

const renderPage = () => render(<V2Frame><ProjectsPage /></V2Frame>);
/** the desktop table row of a project (the link that holds the five columns) */
const row = async (name: string) => {
  const rows = (await screen.findAllByText(name)).map((el) => el.closest("div.grid")).filter((r): r is HTMLElement => r !== null);
  return rows[0];
};

/** table rows with this name (the side panel also lists project names, so only grid rows count) */
const tableRows = (name: string) => screen.queryAllByText(name).filter((el) => el.closest("div.grid"));

beforeEach(() => vi.clearAllMocks());

describe("New UI: Projects list", () => {
  it("shows code, lead, work packages, stage, progress and status from the saved projects, and '—' where there is no data", async () => {
    renderPage();
    const r1 = await row("mRNA Vaccine Stability");
    expect(within(r1).getByRole("link", { name: /mRNA Vaccine Stability/ }).getAttribute("href")).toBe("/projects/mrna-vaccine-stability-p1");   // links use the slug
    expect(within(r1).getByText("P-001")).toBeInTheDocument();
    expect(within(r1).getByText("Sarah Chen")).toBeInTheDocument();
    expect(within(r1).getByText("42%")).toBeInTheDocument();
    expect(within(r1).getByText("In Progress")).toBeInTheDocument();

    const r2 = await row("Perovskite Degradation");
    expect(within(r2).getAllByText("—").length).toBeGreaterThanOrEqual(2);   // no lead and no progress yet
    expect(within(r2).getByText("Draft")).toBeInTheDocument();
    expect(within(r2).getByRole("button", { name: "Delete draft" })).toBeInTheDocument();   // drafts can be deleted
    expect(within(r1).queryByRole("button", { name: "Delete draft" })).toBeNull();     // created projects cannot

    expect(screen.getByText("Total Projects").nextSibling?.textContent).toBe("2");  // side panel count
  });

  it("filters the list by status and search text", async () => {
    renderPage();
    await row("mRNA Vaccine Stability");
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.change(screen.getByLabelText("Status filter"), { target: { value: "Draft" } });
    expect(tableRows("mRNA Vaccine Stability")).toHaveLength(0);
    expect(tableRows("Perovskite Degradation")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Status filter"), { target: { value: "All" } });
    fireEvent.change(screen.getByLabelText("Find a project"), { target: { value: "P-001" } });
    expect(tableRows("Perovskite Degradation")).toHaveLength(0);
  });

  it("shows an error with a retry when the projects cannot load", async () => {
    vi.mocked(api.projects).mockRejectedValueOnce(new Error("Cannot reach the server"));
    renderPage();
    expect(await screen.findByText(/Could not load projects: Cannot reach the server/)).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();
  });
});
