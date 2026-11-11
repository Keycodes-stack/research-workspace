import { Suspense } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sig = { id: "s1", category: "risk", text: "Degradation at 25 °C within 3 weeks", status: "new", confidence: "low",
  models_agree: false, source_count: 1, merged_into: null, created_at: "2026-01-01" };
const detail = { ...sig, status_reason: null, evidence: [
  { id: "e1", chunk_id: "c1", quote: "caused degradation within 3 weeks", model: "model_a", match_kind: "exact", label: "Okafor 2023",
    page_start: 2, page_end: 2, chunk_text: "x", intact: false }] };

vi.mock("@/lib/api", () => ({
  api: {
    signals: vi.fn(async () => [sig]), signal: vi.fn(async () => detail),
    signalAction: vi.fn(async () => ({ status: "dismissed" })), scanSignals: vi.fn(async () => ({ created: 1, already_known: 0, skipped: [] })),
  },
  getToken: () => "t", setToken: () => {}, ApiError: class extends Error {},
}));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

import SignalsPage from "@/app/projects/[id]/signals/page";
import { api } from "@/lib/api";

// React's use() reads an already-settled thenable synchronously
const params = Object.assign(Promise.resolve({ id: "p1" }), { status: "fulfilled", value: { id: "p1" } }) as Promise<{ id: string }>;
beforeEach(() => vi.clearAllMocks());

describe("Signal board", () => {
  it("shows confidence, flags a changed source, and requires a reason to dismiss", async () => {
    const user = userEvent.setup();
    render(<Suspense fallback="loading"><SignalsPage params={params} /></Suspense>);
    expect(await screen.findByText(/Degradation at 25/)).toBeTruthy();
    expect(screen.getByText("low confidence")).toBeTruthy();

    await user.click(screen.getByText("Show evidence"));
    expect(await screen.findByText(/SOURCE CHANGED/)).toBeTruthy();

    await user.click(screen.getByText("Dismiss"));
    const confirm = screen.getByText("Confirm dismiss") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(screen.getByLabelText("Reason"), "out of scope");
    await user.click(confirm);
    await waitFor(() => expect(api.signalAction).toHaveBeenCalledWith("s1", "dismiss", { reason: "out of scope" }));
  });
});
