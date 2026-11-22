"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  Add01Icon,
  ArrowUpRight01Icon,
  Cancel01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import Icon, { huge } from "@/components/v2/dashboard/Icon";
import { TEAM_MEMBERS, type Member } from "@/lib/v2/design/projectScreens";

const PAGE = 8;
/* Figma columns (row 845 wide, padding 16): name 0–124, designation →262, department →401, last update →541, contact →693, profile 120.
 * The table sizes to its own width (container query): below 820px (laptops with both side panels open)
 * "Last Update" folds away and the buttons use short labels, so nothing is cut or scrolled sideways. */
const GRID =
  "grid items-center grid-cols-[minmax(0,140fr)_minmax(0,130fr)_minmax(0,115fr)_minmax(0,110fr)_84px] @min-[820px]:grid-cols-[minmax(0,120fr)_minmax(0,134fr)_minmax(0,128fr)_minmax(0,118fr)_minmax(0,173fr)_120px]";
const WIDE_ONLY = "hidden @min-[820px]:inline";
const inputCls =
  "h-9 w-full rounded-[10px] border border-[#EDEDF0] bg-white px-3 text-xs text-[#101D37] outline-none placeholder:text-body focus:border-blue";

function Avatar({
  m,
  size = 28,
}: {
  m: Pick<Member, "name" | "avatar">;
  size?: number;
}) {
  if (m.avatar)
    return (
      <Image
        src={m.avatar}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full"
        style={{ width: size, height: size }}
      />
    );
  const initials = m.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-blue/10 text-[11px] font-semibold text-blue"
      style={{ width: size, height: size }}
    >
      {initials}
    </span>
  );
}

const today = () =>
  new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/** Figma "Project Teams": Team Members table with search, Add Team Member and full profiles. */
export default function TeamTable({ storageKey }: { storageKey: string }) {
  const [added, setAdded] = useState<Member[]>([]);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    name: "",
    designation: "",
    department: "",
    email: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Member | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setAdded(JSON.parse(raw));
    } catch {
      /* ignore damaged data */
    }
  }, [storageKey]);

  /* close the profile with Escape */
  useEffect(() => {
    if (!profile) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && setProfile(null);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [profile]);

  const all = useMemo(() => [...added, ...TEAM_MEMBERS], [added]);
  const q = query.trim().toLowerCase();
  const list = q
    ? all.filter((m) =>
        [m.name, m.designation, m.department, m.email].some((v) =>
          v.toLowerCase().includes(q),
        ),
      )
    : all;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const f = {
      name: form.name.trim(),
      designation: form.designation.trim(),
      department: form.department.trim(),
      email: form.email.trim(),
    };
    if (!f.name || !f.designation || !f.department)
      return setError("Name, designation and department are required.");
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email))
      return setError("Enter a valid email address.");
    const next = [{ ...f, updated: today() }, ...added];
    setAdded(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* storage full */
    }
    setForm({ name: "", designation: "", department: "", email: "" });
    setError(null);
    setAdding(false);
  };

  return (
    <section className="flex w-full flex-col gap-4 rounded-[20px] border border-[#EDEDF0] bg-[#FAFAFA] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg leading-[1.2] font-semibold tracking-[-0.02em] text-[#101D37]">
          Team Members
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-9 w-[195px] items-center gap-2 rounded-[10px] border border-[#EDEDF0] bg-white px-3">
            <Icon
              icon={huge(Search01Icon)}
              size={14}
              stroke={1.3}
              className="shrink-0 text-body"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search team members"
              className="w-full min-w-0 bg-transparent text-sm text-[#101D37] outline-none placeholder:text-body"
            />
          </label>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            aria-expanded={adding}
            className="flex h-9 items-center gap-1.5 rounded-[10px] bg-blue px-3.5 text-sm font-semibold text-white"
          >
            <Icon icon={huge(Add01Icon)} size={14} stroke={1.6} />
            Add Team Member
          </button>
        </div>
      </div>

      {adding && (
        <form
          onSubmit={save}
          className="grid gap-3 rounded-[12px] border border-[#EDEDF0] bg-white p-4 sm:grid-cols-2"
        >
          <input
            className={inputCls}
            placeholder="Full name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoFocus
          />
          <input
            className={inputCls}
            placeholder="Designation"
            value={form.designation}
            onChange={(e) => setForm({ ...form, designation: e.target.value })}
          />
          <input
            className={inputCls}
            placeholder="Department"
            value={form.department}
            onChange={(e) => setForm({ ...form, department: e.target.value })}
          />
          <input
            className={inputCls}
            placeholder="Email (optional)"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          {error && (
            <p role="alert" className="text-xs text-[#FF2020] sm:col-span-2">
              {error}
            </p>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="submit"
              className="h-9 rounded-[10px] bg-blue px-4 text-xs font-semibold text-white"
            >
              Add member
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
              className="h-9 rounded-[10px] px-3 text-xs font-medium text-body hover:text-[#101D37]"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="@container -mx-5 overflow-x-auto px-5">
        <div className="flex min-w-[560px] flex-col gap-2.5">
          <div
            className={`${GRID} px-4 text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[#101D37]`}
          >
            <span>Full Name</span>
            <span>Designation</span>
            <span>Department</span>
            <span className={WIDE_ONLY}>Last Update</span>
            <span>Contact</span>
            <span>Full Profile</span>
          </div>
          {list.length === 0 && (
            <p className="rounded-[10px] border border-[#EDEDF0] bg-white px-4 py-6 text-center text-xs text-body">
              No team members match “{query}”.
            </p>
          )}
          {list.slice(0, shown).map((m, i) => (
            <div
              key={`${m.name}-${i}`}
              className={`${GRID} h-[50px] rounded-xl border border-[#EDEDF0] bg-white px-4`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <Avatar m={m} />
                <span
                  title={m.name}
                  className="truncate text-xs font-semibold text-[#242C2C]"
                >
                  {m.name}
                </span>
              </div>
              <span
                title={m.designation}
                className="truncate pr-2 text-xs text-body"
              >
                {m.designation}
              </span>
              <span
                title={m.department}
                className="truncate pr-2 text-xs text-body"
              >
                {m.department}
              </span>
              <span className={`${WIDE_ONLY} text-xs text-body`}>
                {m.updated}
              </span>
              {m.email ? (
                <a
                  href={`mailto:${m.email}`}
                  title={`Contact ${m.name}`}
                  className="mr-2 flex h-8 min-w-0 items-center justify-center gap-1 rounded-lg border border-[#EDEDF0] bg-white px-2 text-[11px] font-semibold text-[#101D37] hover:border-blue/40"
                >
                  <span className="truncate">
                    Contact<span className={WIDE_ONLY}> {m.name}</span>
                  </span>
                  <Icon
                    icon={huge(ArrowUpRight01Icon)}
                    size={12}
                    stroke={1.6}
                    className="shrink-0"
                  />
                </a>
              ) : (
                <span className="text-xs text-body">—</span>
              )}
              <button
                type="button"
                onClick={() => setProfile(m)}
                className="flex h-8 items-center justify-center gap-1 rounded-lg bg-blue px-2 text-[11px] font-semibold whitespace-nowrap text-white"
              >
                <span className={WIDE_ONLY}>View Full&nbsp;</span>Profile
                <Icon icon={huge(ArrowUpRight01Icon)} size={12} stroke={1.6} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {list.length > shown && (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE)}
          className="flex items-center gap-1.5 self-start text-xs font-medium text-blue"
        >
          <Icon icon={huge(Add01Icon)} size={13} stroke={1.4} />
          View More People
        </button>
      )}

      {profile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#101D37]/40 p-4"
          onClick={() => setProfile(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${profile.name} profile`}
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-[380px] flex-col gap-4 rounded-[20px] bg-white p-6 shadow-[0_14px_30px_0_rgba(40,92,224,0.10)]"
          >
            <div className="flex items-start justify-between">
              <Avatar m={profile} size={56} />
              <button
                type="button"
                aria-label="Close"
                onClick={() => setProfile(null)}
                className="text-body hover:text-[#101D37]"
              >
                <Icon icon={huge(Cancel01Icon)} size={18} stroke={1.4} />
              </button>
            </div>
            <div>
              <p className="text-lg font-semibold tracking-[-0.02em] text-[#101D37]">
                {profile.name}
              </p>
              <p className="text-sm text-body">{profile.designation}</p>
            </div>
            <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-xs">
              <dt className="text-body">Department</dt>
              <dd className="text-[#101D37]">{profile.department}</dd>
              <dt className="text-body">Email</dt>
              <dd className="truncate text-[#101D37]">
                {profile.email || "—"}
              </dd>
              <dt className="text-body">Last update</dt>
              <dd className="text-[#101D37]">{profile.updated}</dd>
            </dl>
            {profile.email && (
              <a
                href={`mailto:${profile.email}`}
                className="flex h-9 items-center justify-center rounded-[10px] bg-blue text-xs font-semibold text-white"
              >
                Contact {profile.name.split(" ")[0]}
              </a>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
