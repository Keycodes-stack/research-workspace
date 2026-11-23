import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const people = [{ id: "p1", full_name: "Sara Lee", email: null, department: "Operations", job_title: "Engineer", active: true }];
vi.mock("@/lib/api", () => ({
  api: {
    people: vi.fn(async () => people),
    createPerson: vi.fn(),
    updatePerson: vi.fn(async () => ({ id: "p1" })),
  },
  ApiError: class extends Error { status = 0; },
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/organization" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
import OrganizationPage from "@/app/(v2)/(app)/organization/page";
import { api } from "@/lib/api";

beforeEach(() => vi.clearAllMocks());

describe("Organization & Access: people", () => {
  it("edits a person's name, department and title, and clears an empty field", async () => {
    render(<OrganizationPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Edit name"), { target: { value: "Sara Lee-Park" } });
    fireEvent.change(screen.getByLabelText("Edit department"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Edit job title"), { target: { value: "Senior Engineer" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updatePerson).toHaveBeenCalledWith("p1", {
      full_name: "Sara Lee-Park", department: null, job_title: "Senior Engineer", email: null,
    }));
  });

  it("does not save a blank name", async () => {
    render(<OrganizationPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Edit name"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
