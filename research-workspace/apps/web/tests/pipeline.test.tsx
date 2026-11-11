import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ decide: vi.fn(), gates: vi.fn(), decisions: vi.fn() }));
vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    constructor(public status: number, public detail: unknown, m: string) { super(m); }
    get code() { return (this.detail as { error?: string }).error ?? null; }
  }
  return { api: { decide: h.decide, gates: h.gates, decisions: h.decisions }, ApiError };
});
import { ApiError } from "@/lib/api";
import PipelinePanel from "@/components/PipelinePanel";

const failing = [
  { name: "source integrity", passed: true, detail: "0 changed", overridable: false },
  { name: "evidence score >= 40", passed: false, detail: "evidence score is 10", overridable: true },
];

describe("PipelinePanel", () => {
  it("lets a failed gate be overridden only with the checkbox, and sends the flag", async () => {
    h.gates.mockResolvedValue({ stage: "evaluation", next: "validation", gates: failing, ready: false });
    h.decisions.mockResolvedValue([]);
    h.decide.mockRejectedValueOnce(new ApiError(409, { error: "gate_failed", gates: failing }, "gate")).mockResolvedValueOnce({ from: "evaluation", to: "validation" });
    const user = userEvent.setup();
    render(<PipelinePanel conceptId="c1" />);
    expect(await screen.findByText(/evidence score is 10/)).toBeTruthy();
    await user.type(screen.getByLabelText("Reason"), "Partner needs an answer this week, accepting the risk");
    await user.click(screen.getByText("Record decision"));
    await waitFor(() => expect(h.decide).toHaveBeenLastCalledWith("c1", "advance", expect.any(String), false));
    await user.click(await screen.findByLabelText(/Override failed gates/));
    await user.click(screen.getByText("Record decision"));
    await waitFor(() => expect(h.decide).toHaveBeenLastCalledWith("c1", "advance", expect.any(String), true));
  });

  it("offers no override when source integrity fails", async () => {
    h.gates.mockResolvedValue({ stage: "evaluation", next: "validation", ready: false,
      gates: [{ name: "source integrity", passed: false, detail: "1 changed source(s)", overridable: false }] });
    h.decisions.mockResolvedValue([]);
    render(<PipelinePanel conceptId="c1" />);
    expect(await screen.findByText(/cannot be overridden/)).toBeTruthy();
    expect(screen.queryByLabelText(/Override failed gates/)).toBeNull();
  });
});
