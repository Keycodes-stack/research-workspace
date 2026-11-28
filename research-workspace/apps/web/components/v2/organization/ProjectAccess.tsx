"use client";

import { useEffect, useState } from "react";
import { api, ApiError, currentUserId } from "@/lib/api";
import RemoveButton from "@/components/v2/ui/RemoveButton";
import type { Member, ProjectRole } from "@/lib/types";

const LEVELS = [
  { value: "viewer", label: "Viewer · can see everything" },
  { value: "researcher", label: "Researcher · adds sources, asks, builds" },
  { value: "lead_scientist", label: "Lead scientist · approves and moves gates" },
  { value: "admin", label: "Admin · manages members and roles" },
  { value: "owner", label: "Owner · full control" },
];
const LEVEL_RANK = LEVELS.map((l) => l.value);
const levelName = (v: string) => LEVELS.find((l) => l.value === v)?.label.split(" · ")[0] ?? v;

/**
 * Roles and members of one project, shown on the Organization & Access page. A role has a name of the project's
 * choosing and a permission level; the level decides what its members can do. A member's role changes in one click.
 * Until sign-in is added, members are added by their user id.
 */
export default function ProjectAccess({ projectId }: { projectId: string }) {
  const me = currentUserId();
  const [roles, setRoles] = useState<ProjectRole[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [yourRole, setYourRole] = useState("");
  // Role checks are off while everyone shares one access key (the server setting ROLE_RESTRICTIONS).
  const [restricted, setRestricted] = useState(false);
  const [error, setError] = useState("");
  const [newRole, setNewRole] = useState({ name: "", level: "viewer" });
  const [newMember, setNewMember] = useState({ user_id: "", role_id: "" });
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  // Roles and members load independently: one failing call used to blank both sections (Promise.all throws
  // away the good response with the bad one), so a roles failure showed "No members." too, and vice versa.
  const load = async () => {
    const [r, m] = await Promise.allSettled([api.roles(projectId), api.members(projectId)]);
    const problems: string[] = [];
    if (r.status === "fulfilled") {
      setRoles(r.value.roles); setYourRole(r.value.your_role); setRestricted(r.value.role_restrictions);
      setNewMember((x) => (x.role_id || !r.value.roles.length ? x : { ...x, role_id: r.value.roles[0].id }));
    } else {
      problems.push(`roles (${r.reason instanceof Error ? r.reason.message : "could not be loaded"})`);
    }
    if (m.status === "fulfilled") setMembers(m.value.members);
    else problems.push(`members (${m.reason instanceof Error ? m.reason.message : "could not be loaded"})`);
    setError(problems.length ? `Could not load the project's ${problems.join(" and ")}.` : "");
  };
  useEffect(() => { void load(); }, [projectId]);

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setError("");
    try { await action(); await load(); }
    catch (e) { setError(e instanceof ApiError || e instanceof Error ? e.message : fallback); }
  };

  const input = "rounded-[10px] border border-[#EDEDF0] bg-white px-3 py-2 text-sm text-[#101D37] outline-none focus:border-blue";
  const canManage = !restricted || LEVEL_RANK.indexOf(yourRole) >= LEVEL_RANK.indexOf("admin");

  return <div className="flex flex-col gap-5">
    {error && <p role="alert" className="text-sm text-[#B42318]">{error}</p>}

    <section aria-label="Roles" className="rounded-[16px] border border-[#EDEDF0] bg-white p-5">
      <h3 className="text-base font-semibold text-[#101D37]">Roles</h3>
      <ul className="mt-3 flex flex-col divide-y divide-[#EDEDF0]">
        {roles.map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          {renaming?.id === r.id ? <div className="flex items-center gap-2">
            <input aria-label="Role name" value={renaming.name} maxLength={60} onChange={(e) => setRenaming({ id: r.id, name: e.target.value })} className={input} />
            <button type="button" onClick={() => void run(async () => { await api.updateRole(projectId, r.id, { name: renaming.name.trim() }); setRenaming(null); }, "The role could not be renamed.")} className="text-sm font-semibold text-blue">Save</button>
            <button type="button" onClick={() => setRenaming(null)} className="text-sm font-semibold text-[#667085]">Cancel</button>
          </div> : <div>
            <p className="font-medium text-[#101D37]">{r.name}</p>
            <p className="text-xs text-[#667085]">{r.members} member{r.members === 1 ? "" : "s"}</p>
          </div>}
          <div className="flex flex-wrap items-center gap-3">
            <select aria-label={`Level of ${r.name}`} value={r.level} disabled={!canManage}
              onChange={(e) => void run(() => api.updateRole(projectId, r.id, { level: e.target.value }), "The level could not be changed.")}
              className={input}>
              {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
            {canManage && renaming?.id !== r.id && <button type="button" onClick={() => setRenaming({ id: r.id, name: r.name })} className="text-sm font-semibold text-blue">Rename</button>}
            {canManage && <RemoveButton label="Delete" disabled={r.members > 0} title={r.members > 0 ? "Move the members to another role first" : "Delete this role"} onClick={() => void run(() => api.deleteRole(projectId, r.id), "The role could not be deleted.")} />}
          </div>
        </li>)}
      </ul>
      {canManage && <form className="mt-4 flex flex-wrap items-end gap-3 border-t border-[#EDEDF0] pt-4" onSubmit={(e) => { e.preventDefault(); if (newRole.name.trim()) void run(async () => { await api.createRole(projectId, { name: newRole.name.trim(), level: newRole.level }); setNewRole({ name: "", level: "viewer" }); }, "The role could not be created."); }}>
        <label className="flex flex-col gap-1 text-sm text-[#344054]">New role name
          <input aria-label="New role name" value={newRole.name} maxLength={60} onChange={(e) => setNewRole((x) => ({ ...x, name: e.target.value }))} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-[#344054]">Level
          <select aria-label="New role level" value={newRole.level} onChange={(e) => setNewRole((x) => ({ ...x, level: e.target.value }))} className={input}>
            {LEVELS.filter((l) => l.value !== "owner" || yourRole === "owner").map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </label>
        <button type="submit" disabled={!newRole.name.trim()} className="rounded-[10px] bg-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Add role</button>
      </form>}
    </section>

    <section aria-label="Members" className="rounded-[16px] border border-[#EDEDF0] bg-white p-5">
      <h3 className="text-base font-semibold text-[#101D37]">Members</h3>
      {members.length === 0 ? <p className="mt-3 text-sm text-[#667085]">No members.</p> : <ul className="mt-3 flex flex-col divide-y divide-[#EDEDF0]">
        {members.map((m) => {
          const isMe = m.user_id === me;
          const canChange = isMe || canManage;
          return <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[#101D37]">{m.user_id}{isMe && <span className="ml-2 rounded-md bg-blue/[0.08] px-1.5 py-0.5 text-[11px] font-semibold text-blue">You</span>}</p>
              <p className="text-xs text-[#667085]">Level: {levelName(m.role)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select aria-label={`Role of ${m.user_id}`} value={m.role_id ?? ""} disabled={!canChange}
                onChange={(e) => void run(() => api.setRole(projectId, m.user_id, { role_id: e.target.value }), "The role could not be changed.")}
                className={input}>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name} ({levelName(r.level)})</option>)}
              </select>
              {canManage && !isMe && <RemoveButton onClick={() => void run(() => api.removeMember(projectId, m.user_id), "The member could not be removed.")} />}
            </div>
          </li>;
        })}
      </ul>}
      {canManage && roles.length > 0 && <form className="mt-4 flex flex-wrap items-end gap-3 border-t border-[#EDEDF0] pt-4" onSubmit={(e) => { e.preventDefault(); if (newMember.user_id.trim()) void run(async () => { await api.addMember(projectId, newMember.user_id.trim(), { role_id: newMember.role_id }); setNewMember((x) => ({ ...x, user_id: "" })); }, "The member could not be added."); }}>
        <label className="flex flex-col gap-1 text-sm text-[#344054]">User ID
          <input aria-label="User ID" value={newMember.user_id} onChange={(e) => setNewMember((x) => ({ ...x, user_id: e.target.value }))} placeholder="Their sign-in user ID" className={`${input} min-w-[260px]`} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-[#344054]">Role
          <select aria-label="New member role" value={newMember.role_id} onChange={(e) => setNewMember((x) => ({ ...x, role_id: e.target.value }))} className={input}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name} ({levelName(r.level)})</option>)}
          </select>
        </label>
        <button type="submit" disabled={!newMember.user_id.trim()} className="rounded-[10px] bg-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Add member</button>
      </form>}
    </section>
  </div>;
}
