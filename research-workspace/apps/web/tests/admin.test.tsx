import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  members: vi.fn(), usage: vi.fn(), audit: vi.fn(), setBudget: vi.fn(), addMember: vi.fn(), setRole: vi.fn(), removeMember: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api: h, getToken: () => "t", setToken: () => {}, ApiError: class extends Error {} }));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
import Page from "@/app/projects/[id]/admin/page";

const params = Object.assign(Promise.resolve({ id: "p1" }), { status: "fulfilled", value: { id: "p1" } }) as Promise<{ id: string }>;
const U = "11111111-1111-4111-8111-111111111111";

describe("Admin page", () => {
  it("shows members, usage and audit, and sends the new budget", async () => {
    h.members.mockResolvedValue({ you: "admin", members: [{ user_id: U, role: "owner", created_at: "2026-01-01" }],
      permissions: [{ capability: "View everything", min_role: "viewer" }] });
    h.usage.mockResolvedValue({ month_calls: 3, monthly_call_budget: 10, remaining: 7, by_kind: [{ kind: "ask", operations: 1, model_calls: 3, chars_in: 1, chars_out: 1 }], by_user: [], note: "n" });
    h.audit.mockResolvedValue({ entries: [{ id: 1, actor: U, action: "task.approve", target_type: "task", target_id: "t", detail: { sources: 2 }, created_at: "2026-01-01T00:00:00Z" }], next_before: null });
    h.setBudget.mockResolvedValue({});
    const user = userEvent.setup();
    render(<Suspense fallback="loading"><Page params={params} /></Suspense>);
    expect(await screen.findByText("task.approve")).toBeTruthy();
    expect(await screen.findByText(/7 left/)).toBeTruthy();
    expect(screen.getByLabelText(`Role for ${U}`)).toBeTruthy();
    await user.type(screen.getByLabelText("Monthly budget"), "50");
    await user.click(screen.getByText("Set budget"));
    await waitFor(() => expect(h.setBudget).toHaveBeenCalledWith("p1", 50));
  });

  it("will not enable Add member until the user id looks like a UUID", async () => {
    h.members.mockResolvedValue({ you: "owner", members: [], permissions: [] });
    h.usage.mockResolvedValue({ month_calls: 0, monthly_call_budget: null, remaining: null, by_kind: [], by_user: [], note: "" });
    h.audit.mockResolvedValue({ entries: [], next_before: null });
    const user = userEvent.setup();
    render(<Suspense fallback="loading"><Page params={params} /></Suspense>);
    const btn = (await screen.findByText("Add member")) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    await user.type(screen.getByLabelText("User ID"), U);
    expect(btn.disabled).toBe(false);
  });
});
