import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ saveSection: vi.fn(), lock: vi.fn(), unlock: vi.fn(), addComment: vi.fn(), resolveComment: vi.fn() }));
vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    constructor(public status: number, public detail: unknown, m: string) { super(m); }
    get code() { return (this.detail as { error?: string }).error ?? null; }
  }
  return { api: h, ApiError };
});
import CommentsPanel from "@/components/CommentsPanel";
import SectionEditor from "@/components/SectionEditor";

describe("live section editing", () => {
  it("adopts a remote update when you have not typed, but never overwrites what you are typing", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SectionEditor conceptId="c" k="problem" initial="v1" version={1} onSaved={() => {}} />);
    const box = () => screen.getByRole("textbox") as HTMLTextAreaElement;
    rerender(<SectionEditor conceptId="c" k="problem" initial="remote v2" version={2} onSaved={() => {}} />);
    await waitFor(() => expect(box().value).toBe("remote v2"));              // clean: adopted silently

    await user.type(box(), " + mine");
    rerender(<SectionEditor conceptId="c" k="problem" initial="remote v3" version={3} onSaved={() => {}} />);
    expect(await screen.findByText(/saved a newer version while you were typing/)).toBeTruthy();
    expect(box().value).toBe("remote v2 + mine");                            // dirty: untouched
    await user.click(screen.getByText("Use their version"));
    expect(box().value).toBe("remote v3");
  });

  it("takes a lock on focus when live and shows who else is editing", async () => {
    h.lock.mockResolvedValue({}); h.unlock.mockResolvedValue({});
    const user = userEvent.setup();
    render(<SectionEditor conceptId="c" k="risks" initial="" version={0} live lockedBy="abcd1234" onSaved={() => {}} />);
    expect(screen.getByText(/Being edited by abcd1234/)).toBeTruthy();
    await user.click(screen.getByRole("textbox"));
    await waitFor(() => expect(h.lock).toHaveBeenCalledWith("c", "risks"));
    await user.tab();
    await waitFor(() => expect(h.unlock).toHaveBeenCalledWith("c", "risks"));
  });
});

describe("CommentsPanel", () => {
  const data = {
    note: "Comments are written by people and are not source-verified.",
    summary: { hypothesis: { support: 0, challenge: 1, question: 0, note: 0 } },
    comments: [
      { id: "1", parent_id: null, section: "hypothesis", author: "aaaaaaaa-0000", stance: "challenge" as const, body: "Needs a control", resolved: false, created_at: "" },
      { id: "2", parent_id: "1", section: "hypothesis", author: "bbbbbbbb-0000", stance: "support" as const, body: "Table 2 has it", resolved: false, created_at: "" },
    ],
  };
  it("nests replies, summarises open threads and posts with a stance", async () => {
    h.addComment.mockResolvedValue({});
    const user = userEvent.setup();
    render(<CommentsPanel conceptId="c" data={data} onChange={() => {}} />);
    expect(screen.getByText("Table 2 has it")).toBeTruthy();
    expect(screen.getByText(/hypothesis \(1 challenge\)/)).toBeTruthy();
    expect(screen.getByText(/not source-verified/)).toBeTruthy();
    await user.type(screen.getByLabelText("Comment"), "Please cite");
    await user.selectOptions(screen.getByLabelText("Stance"), "question");
    await user.click(screen.getByText("Post comment"));
    await waitFor(() => expect(h.addComment).toHaveBeenCalledWith("c", "Please cite", "question", null));
  });
});
