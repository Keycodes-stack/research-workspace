import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvidenceLibrary as Library } from "@/lib/types";

const library: Library = {
  summary: { total_sources: 12, claims_supported: 1, need_verification: 1 },
  models: { model_a: { label: "Mistral mistral-small-latest" }, model_b: { label: "Groq llama-3.1-8b-instant" } },
  runs: [{
    task_id: "t1", status: "complete", question: "q", statement: "Both models agree on the main claim.", papers_read: 10,
    models: {}, error: null, references_added: true, started_at: "", finished_at: "", code: "WP-1",
    work_package_title: "Chassis research",
  }],
  items: [
    {
      id: "e1", evidence_id: "Evidence 001", task_id: "t1", work_package_code: "WP-1", work_package_title: "Chassis research",
      claim_text: "Aluminium reduces chassis mass.", quote: "aluminium alloys reduce mass by 20%", status: "verified",
      found_by: ["model_a", "model_b"], confirmed: true, chunk_ids: ["c1"], source_id: "s1",
      source_title: "Alloy study", doi: "10.1/a", source_url: "https://doi.org/10.1/a", origin: "openalex",
      pub_year: 2024, created_at: "2026-11-24T00:00:00Z",
    },
    {
      id: "e2", evidence_id: "Evidence 002", task_id: "t1", work_package_code: "WP-1", work_package_title: "Chassis research",
      claim_text: "Steel is cheaper per kilogram.", quote: "", status: "pending", found_by: ["model_b"], confirmed: false,
      chunk_ids: [], source_id: null, source_title: "Steel report", doi: null, source_url: null, origin: "user_upload",
      pub_year: null, created_at: null,
    },
  ],
};

const projectEvidence = vi.fn(async () => library);
const runTaskEvidence = vi.fn(async () => ({ task_id: "t1", status: "queued" }));
const evidenceDetail = vi.fn(async () => ({
  item: library.items[0],
  passages: [{ chunk_id: "c1", source_title: "Alloy study", page_start: 3, page_end: 3, sha256: "abcdef1234567890", text: "Passage text." }],
  statement: "Both models agree on the main claim.",
  models: library.models,
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/projects/p1/evidence",
  useRouter: () => ({ push, replace: vi.fn() }),
  useParams: () => ({ id: "p1" }),
}));
vi.mock("@/lib/api", () => ({
  api: {
    projectEvidence: (...args: unknown[]) => projectEvidence(...(args as [])),
    runTaskEvidence: (...args: unknown[]) => runTaskEvidence(...(args as [])),
    evidenceDetail: (...args: unknown[]) => evidenceDetail(...(args as [])),
  },
}));
vi.mock("@/components/v2/V2Frame", () => ({
  useProjects: () => ({ projects: [{ id: "p1", slug: "dna", name: "DNA heat study" }], loading: false, error: null }),
}));

import EvidenceLibrary from "@/components/v2/evidence/EvidenceLibrary";

beforeEach(() => { vi.clearAllMocks(); });

describe("Evidence Library", () => {
  it("shows the totals, the work package run and each evidence record", async () => {
    render(<EvidenceLibrary id="p1" />);
    expect(await screen.findByText("Project: DNA heat study")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Need verification").previousSibling).toHaveTextContent("1");
    const runItem = screen.getByText("10 papers read").closest("li") as HTMLElement;
    expect(within(runItem).getByText("WP-1 · Chassis research")).toBeInTheDocument();
    expect(within(runItem).getByText("Complete")).toBeInTheDocument();

    const first = screen.getByRole("listitem", { name: "Evidence 001" });
    expect(within(first).getByText("Verified")).toBeInTheDocument();
    expect(within(first).getByText("Mistral mistral-small-latest")).toBeInTheDocument();
    expect(within(first).getByText("Groq llama-3.1-8b-instant")).toBeInTheDocument();
    expect(within(first).getByText(/Published 2024/)).toBeInTheDocument();

    const second = screen.getByRole("listitem", { name: "Evidence 002" });
    expect(within(second).getByText("Pending verification")).toBeInTheDocument();
  });

  it("opens the details with the judge statement and the cited passage", async () => {
    render(<EvidenceLibrary id="p1" />);
    const first = await screen.findByRole("listitem", { name: "Evidence 001" });
    await userEvent.click(within(first).getByRole("button", { name: /View evidence details/ }));
    const dialog = await screen.findByRole("dialog", { name: "Evidence 001 details" });
    expect(await within(dialog).findByText("Passage text.")).toBeInTheDocument();
    expect(within(dialog).getByText(/Both models agree/)).toBeInTheDocument();
    expect(evidenceDetail).toHaveBeenCalledWith("t1", "e1");
  });

  it("asks the server to filter when a filter changes", async () => {
    render(<EvidenceLibrary id="p1" />);
    await screen.findByRole("listitem", { name: "Evidence 001" });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Status" }), "pending");
    expect(projectEvidence).toHaveBeenLastCalledWith("p1", { status: "pending" });
  });

  it("re-runs a finished work package and opens the Home tab", async () => {
    render(<EvidenceLibrary id="p1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Run again" }));
    expect(runTaskEvidence).toHaveBeenCalledWith("t1");
    expect(push).toHaveBeenCalledWith("/home");
  });

  it("stays on the page when the run cannot start", async () => {
    runTaskEvidence.mockRejectedValueOnce(new Error("The models are busy."));
    render(<EvidenceLibrary id="p1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Run again" }));
    expect(runTaskEvidence).toHaveBeenCalledWith("t1");
    expect(push).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("The models are busy.");
  });
});
