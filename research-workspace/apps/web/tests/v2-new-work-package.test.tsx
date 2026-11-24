import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createWorkPackage = vi.fn(async () => ({ id: "t9", code: "WP-3", title: "Battery tests" }));
vi.mock("@/lib/api", () => ({
  api: { createWorkPackage: (...args: unknown[]) => createWorkPackage(...(args as [])) },
}));

import NewWorkPackage from "@/components/v2/projects/NewWorkPackage";

beforeEach(() => { vi.clearAllMocks(); });

describe("New work package", () => {
  it("creates a work package with its title and brief, then reloads the list", async () => {
    const onCreated = vi.fn();
    render(<NewWorkPackage projectId="p1" onCreated={onCreated} />);
    await userEvent.click(screen.getByRole("button", { name: "+ New work package" }));
    const form = screen.getByRole("form", { name: "New work package" });
    await userEvent.type(form.querySelector("input") as HTMLInputElement, "Battery tests");
    await userEvent.type(form.querySelector("textarea") as HTMLTextAreaElement, "Compare cells");
    await userEvent.click(screen.getByRole("button", { name: "Create work package" }));
    expect(createWorkPackage).toHaveBeenCalledWith("p1", { title: "Battery tests", brief: "Compare cells" });
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("refuses an empty title without calling the server", async () => {
    render(<NewWorkPackage projectId="p1" onCreated={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "+ New work package" }));
    await userEvent.type(screen.getByRole("form", { name: "New work package" }).querySelector("input") as HTMLInputElement, "   ");
    await userEvent.click(screen.getByRole("button", { name: "Create work package" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Give the work package a title.");
    expect(createWorkPackage).not.toHaveBeenCalled();
  });
});
