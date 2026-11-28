import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

const createWorkPackage = vi.fn(async () => ({ id: "t9", code: "WP-3", title: "Battery tests" }));
vi.mock("@/lib/api", () => ({
  api: { createWorkPackage: (...args: unknown[]) => createWorkPackage(...(args as [])) },
}));

import NewWorkPackage from "@/components/v2/projects/NewWorkPackage";

beforeEach(() => { vi.clearAllMocks(); });

describe("New work package", () => {
  it("opens the form on click, creates a work package with its title and brief, reloads the list, then opens Home", async () => {
    const onCreated = vi.fn();
    render(<NewWorkPackage projectId="p1" onCreated={onCreated} />);
    await userEvent.click(screen.getByRole("button", { name: "+ New work package" }));
    const form = screen.getByRole("form", { name: "New work package" });
    await userEvent.type(form.querySelector("input") as HTMLInputElement, "Battery tests");
    await userEvent.type(form.querySelector("textarea") as HTMLTextAreaElement, "Compare cells");
    await userEvent.click(screen.getByRole("button", { name: "Create work package" }));
    expect(createWorkPackage).toHaveBeenCalledWith("p1", { title: "Battery tests", brief: "Compare cells" });
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/home");
  });

  it("refuses an empty title without calling the server", async () => {
    render(<NewWorkPackage projectId="p1" onCreated={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "+ New work package" }));
    await userEvent.type(screen.getByRole("form", { name: "New work package" }).querySelector("input") as HTMLInputElement, "   ");
    await userEvent.click(screen.getByRole("button", { name: "Create work package" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Give the work package a title.");
    expect(createWorkPackage).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("shows the error and stays on the page when creating fails", async () => {
    createWorkPackage.mockRejectedValueOnce(new Error("Could not create the work package."));
    render(<NewWorkPackage projectId="p1" onCreated={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "+ New work package" }));
    await userEvent.type(screen.getByRole("form", { name: "New work package" }).querySelector("input") as HTMLInputElement, "Battery tests");
    await userEvent.click(screen.getByRole("button", { name: "Create work package" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not create the work package.");
    expect(push).not.toHaveBeenCalled();
  });

  it("closes the form on Cancel without creating anything", async () => {
    render(<NewWorkPackage projectId="p1" onCreated={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "+ New work package" }));
    expect(screen.getByRole("form", { name: "New work package" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "New work package" })).not.toBeInTheDocument();
    expect(createWorkPackage).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
