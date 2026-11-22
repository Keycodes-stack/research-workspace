import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const projects = [
  { id: "p1", name: "DNA heat study", mode: "open_discovery", meta: {} },
  { id: "p2", name: "Battery recycling", mode: "closed_repository", meta: {} },
];

vi.mock("next/navigation", () => ({
  usePathname: () => "/v2/projects/p1/departments",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ id: "p1" }),
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("next/image", () => ({ default: ({ alt }: { alt: string }) => <img alt={alt} /> }));
vi.mock("@/lib/api", () => ({
  api: { projects: vi.fn(async () => projects) },
  getToken: () => "t", setToken: () => {}, consumeTokenFragment: () => {}, ApiError: class extends Error {},
}));

import V2Frame from "@/components/v2/V2Frame";
import DepartmentsPage from "@/app/(v2)/v2/projects/[id]/departments/page";
import BaselinePage from "@/app/(v2)/v2/projects/[id]/baseline/page";
import EvidencePage from "@/app/(v2)/v2/projects/[id]/evidence/page";
import KnowledgePage from "@/app/(v2)/v2/knowledge/page";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => { localStorage.clear(); });

describe("project pages from the design (sample content, real projects)", () => {
  it("lists real projects in the panel with the project pages under /v2", async () => {
    render(<V2Frame>{await DepartmentsPage(params("p1"))}</V2Frame>);
    expect(await screen.findByRole("heading", { name: "Departments & Workstreams" })).toBeInTheDocument();
    expect(screen.getByText("Workstream Matrix")).toBeInTheDocument();                         // design sample
    const panel = screen.getByRole("navigation", { name: "Project" });
    expect(within(panel).getByRole("link", { name: /Baseline & Approvals/ })).toHaveAttribute("href", "/v2/projects/p1/baseline");
    expect(within(panel).getByRole("link", { name: /Departments/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Battery recycling" })).toHaveAttribute("href", "/v2/projects/p2");
  });

  it("shows the design's not-found card for a project that is not in the workspace", async () => {
    render(<V2Frame>{await BaselinePage(params("nope"))}</V2Frame>);
    expect(await screen.findByText("Page not found")).toBeInTheDocument();
    expect(screen.queryByText("Baseline Summary")).toBeNull();
  });

  it("keeps the sample decision names without links to projects that do not exist here", async () => {
    render(<V2Frame>{await BaselinePage(params("p1"))}</V2Frame>);
    expect(await screen.findByText("Baseline Summary")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Industrial Heat Recovery/ })).toBeNull();
  });

  it("opens Evidence from the work packages, with Workspace not linked until it is built", async () => {
    render(<V2Frame>{await EvidencePage(params("p1"))}</V2Frame>);
    expect(await screen.findByRole("heading", { name: "Evidence Extraction Ledger" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Evidence" })).toHaveAttribute("href", "/v2/projects/p1/evidence");
    expect(screen.getByRole("link", { name: "Workspace" })).toHaveAttribute("href", "#");
  });

  it("shows the Knowledge Library", async () => {
    render(<V2Frame><KnowledgePage /></V2Frame>);
    expect(await screen.findByRole("heading", { name: "Knowledge Library" })).toBeInTheDocument();
  });
});
