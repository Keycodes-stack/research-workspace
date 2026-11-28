"use client";

import { useEffect, useState } from "react";
import TopBar from "@/components/v2/dashboard/TopBar";
import ProjectAccess from "@/components/v2/organization/ProjectAccess";
import { useProjects } from "@/components/v2/V2Frame";
import { api, ApiError } from "@/lib/api";
import type { Person, Project } from "@/lib/types";

type Fields = { full_name: string; department: string; job_title: string; email: string };
const EMPTY: Fields = { full_name: "", department: "", job_title: "", email: "" };

/** The people directory: the sponsors, project leads and core team members the wizard chooses from. */
export default function OrganizationPage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<Fields>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Fields>(EMPTY);
  const { projects } = useProjects();
  const [accessProject, setAccessProject] = useState("");
  const chosenProject = accessProject || projects[0]?.id || "";
  /* The code comes first: two projects can share a title (P-038 and P-039 are
     both "AI"), and a long title truncated to the select's width still shows
     the code that tells them apart. Projects without a code show just the title. */
  const labelOf = (p: Project) => (p.code ? `${p.code} — ${p.name}` : p.name);
  const chosen = projects.find((p) => p.id === chosenProject);

  // The gateway answers 502 ("upstream unavailable") while the AI service restarts or wakes up, so one
  // transient failure must not leave the directory blank: retry once after a short pause, then show the error.
  const load = async () => {
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          setPeople(await api.people(true)); setError(""); return;
        } catch (e) {
          const transient = e instanceof ApiError && (e.status === 502 || e.status === 0);
          if (!transient || attempt >= 1) {
            setError(e instanceof Error ? e.message : "The directory could not be loaded.");
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const add = async () => {
    setSaving(true); setError("");
    try {
      await api.createPerson({ full_name: form.full_name, department: form.department || null, job_title: form.job_title || null, email: form.email || null });
      setForm(EMPTY);
      await load();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "The person could not be added.");
    } finally { setSaving(false); }
  };

  const startEdit = (p: Person) => {
    setEditingId(p.id);
    setEdit({ full_name: p.full_name, department: p.department ?? "", job_title: p.job_title ?? "", email: p.email ?? "" });
    setError("");
  };

  const saveEdit = async (id: string) => {
    setError("");
    try {
      // Empty optional fields are sent as null, so clearing a field clears it in the directory.
      await api.updatePerson(id, {
        full_name: edit.full_name.trim(),
        department: edit.department.trim() || null,
        job_title: edit.job_title.trim() || null,
        email: edit.email.trim() || null,
      });
      setEditingId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The change could not be saved.");
    }
  };

  const setActive = async (person: Person, active: boolean) => {
    setError("");
    try { await api.updatePerson(person.id, { active }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "The change could not be saved."); }
  };

  const input = "w-full rounded-[10px] border border-[#EDEDF0] bg-white px-3 py-2 text-sm text-[#101D37] outline-none focus:border-blue";

  return <div className="flex min-w-0 flex-1 flex-col">
    <TopBar current="Organization & Access" />
    <main className="flex flex-col gap-5 px-4 pt-10 pb-16 sm:px-6 lg:px-10">
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[#101D37] sm:text-[30px]">Organization &amp; Access</h1>
      <p className="max-w-2xl text-sm text-[#667085]">People listed here can be chosen as a project sponsor, project lead or core team member. Deactivated people stay on existing projects but cannot be chosen for new ones.</p>

      <section className="rounded-[20px] border border-[#EDEDF0] bg-white p-5">
        <h2 className="text-lg font-semibold text-[#101D37]">Add a person</h2>
        <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (form.full_name.trim()) void add(); }}>
          <input aria-label="Full name" placeholder="Full name" value={form.full_name} maxLength={120} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} className={input} />
          <input aria-label="Department" placeholder="Department" value={form.department} maxLength={120} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} className={input} />
          <input aria-label="Job title" placeholder="Job title" value={form.job_title} maxLength={120} onChange={(e) => setForm((f) => ({ ...f, job_title: e.target.value }))} className={input} />
          <input aria-label="Email" placeholder="Email (optional)" type="email" value={form.email} maxLength={254} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className={input} />
          <div className="md:col-span-2 flex justify-end">
            <button type="submit" disabled={saving || !form.full_name.trim()} className="rounded-[10px] bg-blue px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Add person"}</button>
          </div>
        </form>
      </section>

      <section className="rounded-[20px] border border-[#EDEDF0] bg-white p-5">
        <h2 className="text-lg font-semibold text-[#101D37]">People directory</h2>
        {error && <p role="alert" className="mt-3 text-sm text-[#B42318]">{error}</p>}
        {loading ? <p className="mt-3 text-sm text-[#667085]">Loading…</p> : people.length === 0 ? <p className="mt-3 text-sm text-[#667085]">No people yet.</p> : <table className="mt-4 w-full text-left text-sm">
          <thead><tr className="border-b border-[#EDEDF0] text-xs text-[#667085]"><th className="py-2 font-medium">Name</th><th className="py-2 font-medium">Department</th><th className="py-2 font-medium">Job title</th><th className="py-2 font-medium">Email</th><th className="py-2 font-medium">Status</th><th className="py-2" /></tr></thead>
          <tbody>{people.map((p) => editingId === p.id ? <tr key={p.id} className="border-b border-[#EDEDF0] align-top">
            <td className="py-3 pr-2"><input aria-label="Edit name" value={edit.full_name} maxLength={120} onChange={(e) => setEdit((x) => ({ ...x, full_name: e.target.value }))} className={input} /></td>
            <td className="py-3 pr-2"><input aria-label="Edit department" value={edit.department} maxLength={120} onChange={(e) => setEdit((x) => ({ ...x, department: e.target.value }))} className={input} /></td>
            <td className="py-3 pr-2"><input aria-label="Edit job title" value={edit.job_title} maxLength={120} onChange={(e) => setEdit((x) => ({ ...x, job_title: e.target.value }))} className={input} /></td>
            <td className="py-3 pr-2"><input aria-label="Edit email" type="email" value={edit.email} maxLength={254} onChange={(e) => setEdit((x) => ({ ...x, email: e.target.value }))} className={input} /></td>
            <td className="py-3" />
            <td className="py-3 text-right whitespace-nowrap">
              <button type="button" onClick={() => void saveEdit(p.id)} disabled={!edit.full_name.trim()} className="mr-3 text-sm font-semibold text-blue disabled:opacity-50">Save</button>
              <button type="button" onClick={() => setEditingId(null)} className="text-sm font-semibold text-[#667085]">Cancel</button>
            </td>
          </tr> : <tr key={p.id} className="border-b border-[#EDEDF0] last:border-0">
            <td className="py-3 font-medium text-[#101D37]">{p.full_name}</td>
            <td className="py-3 text-[#344054]">{p.department ?? "—"}</td>
            <td className="py-3 text-[#344054]">{p.job_title ?? "—"}</td>
            <td className="py-3 text-[#344054]">{p.email ?? "—"}</td>
            <td className="py-3"><span className={`rounded-md px-2 py-1 text-xs font-medium ${p.active ? "bg-[#ECFDF3] text-[#067647]" : "bg-[#F2F4F7] text-[#475467]"}`}>{p.active ? "Active" : "Inactive"}</span></td>
            <td className="py-3 text-right whitespace-nowrap">
              <button type="button" onClick={() => startEdit(p)} className="mr-3 text-sm font-semibold text-blue">Edit</button>
              <button type="button" onClick={() => void setActive(p, !p.active)} className="text-sm font-semibold text-[#344054]">{p.active ? "Deactivate" : "Reactivate"}</button>
            </td>
          </tr>)}</tbody>
        </table>}
      </section>

      <section aria-labelledby="project-access" className="flex flex-col gap-4 rounded-[20px] border border-[#EDEDF0] bg-white p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="project-access" className="text-lg font-semibold text-[#101D37]">Project access</h2>
            <p className="mt-1 text-sm text-[#667085]">Define the roles of a project, and set each member&apos;s role.</p>
          </div>
          {projects.length > 0 && <label className="flex min-w-0 items-center gap-2 text-sm text-[#344054]">Project
            <select aria-label="Project" value={chosenProject} onChange={(e) => setAccessProject(e.target.value)}
              title={chosen ? labelOf(chosen) : undefined}
              className="max-w-[min(28rem,calc(100vw-3rem))] truncate rounded-[10px] border border-[#EDEDF0] bg-white px-3 py-2 text-sm text-[#101D37] outline-none focus:border-blue">
              {projects.map((p) => <option key={p.id} value={p.id}>{labelOf(p)}</option>)}
            </select>
          </label>}
        </div>
        {projects.length === 0 ? <p className="text-sm text-[#667085]">No projects yet.</p> : <ProjectAccess key={chosenProject} projectId={chosenProject} />}
      </section>
    </main>
  </div>;
}
