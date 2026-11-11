import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const saveSection = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    constructor(public status: number, public detail: unknown, m: string) { super(m); }
    get code() { return (this.detail as { error?: string }).error ?? null; }
  }
  return { api: { saveSection: (...a: unknown[]) => saveSection(...a) }, ApiError };
});
import { ApiError as FakeApiError } from "@/lib/api";

import SectionEditor from "@/components/SectionEditor";

describe("SectionEditor", () => {
  it("shows the other person's text on a version conflict and lets you adopt it", async () => {
    saveSection.mockRejectedValueOnce(new FakeApiError(409, { error: "version_conflict", current: { body: "Their text", version: 3 } }, "conflict"));
    const user = userEvent.setup();
    render(<SectionEditor conceptId="c1" k="problem" initial="Old" version={2} onSaved={() => {}} />);
    const box = screen.getByRole("textbox");
    await user.clear(box); await user.type(box, "Mine");
    await user.click(screen.getByText("Save Problem"));
    expect(await screen.findByText("Their text")).toBeTruthy();
    await user.click(screen.getByText("Use their version"));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Their text");
  });

  it("saves against the version it loaded", async () => {
    saveSection.mockResolvedValueOnce({ version: 3 });
    const user = userEvent.setup();
    render(<SectionEditor conceptId="c1" k="problem" initial="Old" version={2} onSaved={() => {}} />);
    await user.type(screen.getByRole("textbox"), "!");
    await user.click(screen.getByText("Save Problem"));
    await waitFor(() => expect(saveSection).toHaveBeenLastCalledWith("c1", "problem", "Old!", 2));
  });
});
