import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const roles = [
  { id: "r-owner", name: "Owner", level: "owner", members: 1 },
  { id: "r-view", name: "Site reviewer", level: "viewer", members: 1 },
];
const members = [
  { user_id: "11111111-1111-4111-8111-111111111111", role: "owner", role_id: "r-owner", role_name: "Owner", created_at: "" },
  { user_id: "22222222-2222-4222-8222-222222222222", role: "viewer", role_id: "r-view", role_name: "Site reviewer", created_at: "" },
];
vi.mock("@/lib/api", () => ({
  api: {
    roles: vi.fn(async () => ({ roles, your_role: "owner" })),
    members: vi.fn(async () => ({ you: "owner", members, permissions: [] })),
    setRole: vi.fn(async () => ({})),
    updateRole: vi.fn(async () => ({})),
    createRole: vi.fn(async () => ({ id: "r-new" })),
    deleteRole: vi.fn(async () => null),
    addMember: vi.fn(async () => ({})),
    removeMember: vi.fn(async () => ({})),
  },
  ApiError: class extends Error { status = 0; },
  currentUserId: () => "11111111-1111-4111-8111-111111111111",
}));
import ProjectAccess from "@/components/v2/organization/ProjectAccess";
import { api } from "@/lib/api";

beforeEach(() => vi.clearAllMocks());

describe("Project access: roles and members", () => {
  it("changes another member's role in one step", async () => {
    render(<ProjectAccess projectId="p1" />);
    const select = await screen.findByLabelText("Role of 22222222-2222-4222-8222-222222222222");
    fireEvent.change(select, { target: { value: "r-owner" } });
    await waitFor(() => expect(api.setRole).toHaveBeenCalledWith("p1", "22222222-2222-4222-8222-222222222222", { role_id: "r-owner" }));
  });

  it("marks your own row and lets you change your own role", async () => {
    render(<ProjectAccess projectId="p1" />);
    expect(await screen.findByText("You")).toBeInTheDocument();
    expect(screen.getByLabelText("Role of 11111111-1111-4111-8111-111111111111")).not.toBeDisabled();
  });

  it("changes what a role can do by its level", async () => {
    render(<ProjectAccess projectId="p1" />);
    fireEvent.change(await screen.findByLabelText("Level of Site reviewer"), { target: { value: "researcher" } });
    await waitFor(() => expect(api.updateRole).toHaveBeenCalledWith("p1", "r-view", { level: "researcher" }));
  });
});
