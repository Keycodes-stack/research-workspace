import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvidenceItem } from "@/lib/types";

const items: EvidenceItem[] = [
  {
    id: "e1", evidence_id: "Evidence 001", task_id: "t1", work_package_code: "WP-2",
    work_package_title: "Affect of artificial intelligence in software engineering",
    claim_text: "AI techniques make rapid, automated decisions.", quote: "", status: "verified",
    found_by: ["model_a", "model_b"], confirmed: true, chunk_ids: ["c1"], source_id: "s1",
    source_title: "Systematic Mapping", doi: "10.1/a", source_url: null, origin: "openalex",
    pub_year: 2022, created_at: "2026-11-26T00:00:00Z",
  },
  {
    id: "e2", evidence_id: "Evidence 002", task_id: "t1", work_package_code: "WP-2",
    work_package_title: "Affect of artificial intelligence in software engineering",
    claim_text: "AI is deployed as a key component of modern software systems.", quote: "",
    status: "pending", found_by: ["model_b"], confirmed: false, chunk_ids: [], source_id: null,
    source_title: "Ways of applying AI", doi: null, source_url: null, origin: "openalex",
    pub_year: null, created_at: null,
  },
];

const taskEvidence = vi.fn(async () => ({ run: null, items }));

vi.mock("@/lib/api", () => ({
  api: { taskEvidence: (...args: unknown[]) => taskEvidence(...(args as [])) },
}));

import FindingsList from "@/components/v2/workspace/FindingsList";

beforeEach(() => { vi.clearAllMocks(); taskEvidence.mockResolvedValue({ run: null, items }); });

describe("Findings list", () => {
  it("renders every finding as one highlighted link to its evidence record", async () => {
    render(<FindingsList projectId="p1" taskId="t1" />);
    expect(taskEvidence).toHaveBeenCalledWith("t1");

    const first = await screen.findByRole("link", { name: /Evidence 001: AI techniques make rapid/ });
    expect(first).toHaveAttribute(
      "href",
      "/projects/p1/evidence?work_package=t1",
    );
    expect(first).toHaveTextContent("[1]");
    expect(first).toHaveTextContent("Verified");

    const second = screen.getByRole("link", { name: /Evidence 002: AI is deployed/ });
    expect(second).toHaveAttribute(
      "href",
      "/projects/p1/evidence?work_package=t1",
    );
    expect(second).toHaveTextContent("[2]");
    expect(second).toHaveTextContent("(one model only)");
    expect(second).toHaveTextContent("Pending verification");
  });

  it("shows a plain notice — and no link — when there is no evidence yet", async () => {
    taskEvidence.mockResolvedValueOnce({ run: null, items: [] });
    render(<FindingsList projectId="p1" taskId="t1" />);
    expect(await screen.findByText(/No evidence yet for this work package/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
