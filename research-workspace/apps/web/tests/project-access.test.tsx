import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rolesResp = {
  roles: [
    { id: "r-owner", name: "Owner", level: "owner", members: 1 },
    { id: "r-viewer", name: "Viewer", level: "viewer", members: 0 },
  ],
  your_role: "owner",
  role_restrictions: false,
};
const membersResp = {
  you: "owner",
  members: [{ user_id: "user-1", role: "owner", role_id: "r-owner", role_name: "Owner", created_at: "2026-11-28T00:00:00Z" }],
  permissions: [],
};

vi.mock("@/lib/api", () => ({
  api: {
    roles: vi.fn(),
    members: vi.fn(),
    createRole: vi.fn(),
    updateRole: vi.fn(),
    deleteRole: vi.fn(),
    addMember: vi.fn(),
    setRole: vi.fn(),
    removeMember: vi.fn(),
  },
  ApiError: class extends Error { status = 0; },
  currentUserId: () => "user-1",
}));
import ProjectAccess from "@/components/v2/organization/ProjectAccess";
import { api } from "@/lib/api";

beforeEach(() => vi.clearAllMocks());

describe("Organization & Access: project access loads roles and members independently", () => {
  it("shows both roles and members when both calls succeed", async () => {
    vi.mocked(api.roles).mockResolvedValue(rolesResp);
    vi.mocked(api.members).mockResolvedValue(membersResp);
    render(<ProjectAccess projectId="p1" />);
    expect(await screen.findByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("user-1")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("still shows the members when the roles call fails", async () => {
    vi.mocked(api.roles).mockRejectedValue(new Error("upstream unavailable"));
    vi.mocked(api.members).mockResolvedValue(membersResp);
    render(<ProjectAccess projectId="p1" />);
    // The good response is kept: the members list renders even though roles failed.
    expect(await screen.findByText("user-1")).toBeInTheDocument();
    expect(screen.queryByText("No members.")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/roles/i);
    expect(screen.queryByText("Owner")).not.toBeInTheDocument();
  });

  it("still shows the roles when the members call fails", async () => {
    vi.mocked(api.roles).mockResolvedValue(rolesResp);
    vi.mocked(api.members).mockRejectedValue(new Error("project not found"));
    render(<ProjectAccess projectId="p1" />);
    expect(await screen.findByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("No members.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/members/i);
  });
});
