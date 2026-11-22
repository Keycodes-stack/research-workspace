import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const projects = [
  { id: "p1", name: "mRNA Vaccine Stability", mode: "open_discovery", meta: { lead: "Sarah Chen" } },
  { id: "p2", name: "Perovskite Degradation", mode: "open_discovery", meta: {} },
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
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/projects" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("next/image", () => ({ default: ({ alt }: { alt: string }) => <img alt={alt} /> }));

import V2Frame from "@/components/v2/V2Frame";
import ProjectsPage from "@/app/(v2)/v2/projects/page";
import { api } from "@/lib/api";

const renderPage = () => render(<V2Frame><ProjectsPage /></V2Frame>);
/** the desktop table row of a project (the link that holds the five columns) */
const row = async (name: string) => {
  const links = (await screen.findAllByText(name)).map((el) => el.closest("a")!).filter((a) => a.className.includes("grid"));
  return links[0];
};

beforeEach(() => vi.clearAllMocks());

describe("New UI: Projects list", () => {
  it("shows real projects with lead, research-task count, and '—' where the backend has no data", async () => {
    renderPage();
    const r1 = await row("mRNA Vaccine Stability");
    expect(r1.getAttribute("href")).toBe("/v2/projects/p1");
    await waitFor(() => expect(within(r1).getByText("2")).toBeInTheDocument());   // two research tasks
    expect(within(r1).getByText("Sarah Chen")).toBeInTheDocument();
    expect(within(r1).getAllByText("—")).toHaveLength(3);                            // code, stage, status

    const r2 = await row("Perovskite Degradation");
    await waitFor(() => expect(api.tasks).toHaveBeenCalledWith("p2"));
    expect(within(r2).getAllByText("—")).toHaveLength(5);    // no lead, task count failed, code, stage, status

    expect(screen.getByText("Total Projects").nextSibling?.textContent).toBe("2");  // side panel count
  });

  it("shows an error with a retry when the projects cannot load", async () => {
    vi.mocked(api.projects).mockRejectedValueOnce(new Error("Cannot reach the server"));
    renderPage();
    expect(await screen.findByText(/Could not load projects: Cannot reach the server/)).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();
  });
});
