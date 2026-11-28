import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const people = [{ id: "p1", full_name: "Sara Lee", email: null, department: "Operations", job_title: "Engineer", active: true }];
vi.mock("@/lib/api", () => ({
  api: {
    people: vi.fn(async () => people),
    createPerson: vi.fn(),
    updatePerson: vi.fn(async () => ({ id: "p1" })),
  },
  ApiError: class extends Error { status = 0; },
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(),  usePathname: () => "/organization" }));
const useProjectsMock = vi.hoisted(() => vi.fn());
vi.mock("@/components/v2/V2Frame", () => ({
  useProjects: (...args: unknown[]) => useProjectsMock(...(args as [])),
}));
vi.mock("@/components/v2/organization/ProjectAccess", () => ({
  default: ({ projectId }: { projectId: string }) => <div data-testid="project-access">{projectId}</div>,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
import OrganizationPage from "@/app/(v2)/(app)/organization/page";
import { api, ApiError } from "@/lib/api";

beforeEach(() => {
  vi.clearAllMocks();
  useProjectsMock.mockReturnValue({ projects: [], loading: false, error: null, reload: async () => {} });
});

describe("Organization & Access: people", () => {
  it("edits a person's name, department and title, and clears an empty field", async () => {
    render(<OrganizationPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Edit name"), { target: { value: "Sara Lee-Park" } });
    fireEvent.change(screen.getByLabelText("Edit department"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Edit job title"), { target: { value: "Senior Engineer" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updatePerson).toHaveBeenCalledWith("p1", {
      full_name: "Sara Lee-Park", department: null, job_title: "Senior Engineer", email: null,
    }));
  });

  it("does not save a blank name", async () => {
    render(<OrganizationPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Edit name"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("retries the directory once after a gateway 502, then shows the people", async () => {
    // The gateway answers 502 ("upstream unavailable") while the AI service restarts; the page retries
    // once instead of leaving a red error and "No people yet." on a transient blip.
    const err = new ApiError(502, null, "upstream unavailable");
    (err as unknown as { status: number }).status = 502;
    err.message = "upstream unavailable";
    vi.mocked(api.people).mockRejectedValueOnce(err);
    render(<OrganizationPage />);
    expect(await screen.findByText("Sara Lee", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(api.people).toHaveBeenCalledTimes(2);
  });

  it("shows the error when the retry also fails", async () => {
    const err = new ApiError(502, null, "upstream unavailable");
    (err as unknown as { status: number }).status = 502;
    err.message = "upstream unavailable";
    vi.mocked(api.people).mockRejectedValue(err);
    render(<OrganizationPage />);
    expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent("upstream unavailable");
    expect(screen.getByText("No people yet.")).toBeInTheDocument();
    expect(api.people).toHaveBeenCalledTimes(2);
  });
});

describe("Organization & Access: project dropdown (issue 9a)", () => {
  const projects = [
    { id: "p38", name: "AI", code: "P-038", mode: "open_discovery" },
    { id: "p39", name: "AI", code: "P-039", mode: "open_discovery" },
    { id: "p40", name: "A very long project title that would otherwise be cut off in the dropdown", code: "P-040", mode: "open_discovery" },
  ];

  it("shows each project's code with its title, so duplicate titles are distinguishable", async () => {
    useProjectsMock.mockReturnValue({ projects, loading: false, error: null, reload: async () => {} });
    render(<OrganizationPage />);
    const select = await screen.findByLabelText("Project");
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual([
      "P-038 — AI",
      "P-039 — AI",
      "P-040 — A very long project title that would otherwise be cut off in the dropdown",
    ]);
    /* The first project is chosen by default; its full label is on the select
       itself, so a long title truncated to the select's width is still
       readable on hover. */
    expect(select).toHaveAttribute("title", "P-038 — AI");
    expect(screen.getByTestId("project-access")).toHaveTextContent("p38");
  });

  it("shows just the title when a project has no code", async () => {
    useProjectsMock.mockReturnValue({
      projects: [{ id: "p1", name: "AI", code: null, mode: "open_discovery" }],
      loading: false, error: null, reload: async () => {},
    });
    render(<OrganizationPage />);
    const select = await screen.findByLabelText("Project");
    expect(Array.from(select.querySelectorAll("option")).map((o) => o.textContent)).toEqual(["AI"]);
    expect(select).toHaveAttribute("title", "AI");
  });
});
