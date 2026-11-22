"use client";

import { useRef, useState } from "react";
import {
  Add01Icon,
  BookOpen01Icon,
  CheckmarkBadge01Icon,
  Cancel01Icon,
  CloudUploadIcon,
  Delete02Icon,
  Plug01Icon,
  QuoteDownIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import Icon, { huge } from "@/components/v2/dashboard/Icon";
import { Switch } from "./ResearchPickers";
import {
  APPROVED,
  METHODOLOGIES,
  today,
  updateKnowledge,
  useKnowledge,
  type Repo,
} from "@/lib/v2/design/knowledge";

type Tab = "Repositories" | "Approved Research" | "Methodologies" | "Clips";
const TABS: Tab[] = [
  "Repositories",
  "Approved Research",
  "Methodologies",
  "Clips",
];

const MORE_CONNECTORS = [
  {
    id: "sharepoint",
    name: "SharePoint",
    desc: "Sites and document libraries",
  },
  { id: "confluence", name: "Confluence", desc: "Team spaces and pages" },
  { id: "notion", name: "Notion", desc: "Workspaces and databases" },
  { id: "gdrive", name: "Google Drive", desc: "Shared drives and folders" },
];

const CARD =
  "flex flex-col gap-4 rounded-[20px] border border-[#EDEDF0] bg-white p-5";
const H2 =
  "text-lg leading-[1.2] font-semibold tracking-[-0.02em] text-[#101D37]";
const KIND_STYLE: Record<Repo["kind"], string> = {
  Scholarly: "bg-blue/10 text-blue",
  Patents: "bg-[#7A5AF8]/10 text-[#6941C6]",
  News: "bg-[#FF6720]/10 text-[#FF6720]",
  Drive: "bg-[#2BCB23]/10 text-[#1B8A15]",
  Upload: "bg-[#EDEDF0] text-[#344054]",
  Web: "bg-[#0BA5EC]/10 text-[#026AA2]",
};

/* Repository table: name · status · last used · records · date added · remove */
const GRID =
  "grid grid-cols-[minmax(0,2.2fr)_minmax(120px,1fr)_minmax(0,1fr)_70px_minmax(0,1fr)_36px] items-center gap-3";

export default function KnowledgeLibrary() {
  const k = useKnowledge();
  const [tab, setTab] = useState<Tab>("Repositories");
  const [q, setQ] = useState("");
  const [addText, setAddText] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  /* the upload / connect panel opens from "Add Source" */
  const [adding, setAdding] = useState(false);
  const [drag, setDrag] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLInputElement>(null);

  const flash = (m: string) => {
    setNotice(m);
    setTimeout(() => setNotice(null), 2500);
  };

  const addRepos = (
    items: { name: string; kind: Repo["kind"]; records: number }[],
  ) => {
    if (!items.length) return;
    updateKnowledge((s) => ({
      repos: [
        ...items.map((it, i) => ({
          id: `r${Date.now()}${i}`,
          ...it,
          active: true,
          lastUsed: "Not used yet",
          added: today(),
        })),
        ...s.repos,
      ],
    }));
    flash(
      items.length === 1
        ? `Added “${items[0].name}”.`
        : `Added ${items.length} sources.`,
    );
  };

  const onFiles = (list: FileList | null) => {
    if (!list) return;
    addRepos(
      Array.from(list).map((f) => ({
        name: f.name,
        kind: "Upload" as const,
        records: 1,
      })),
    );
  };

  const addByName = () => {
    const v = addText.trim();
    if (!v) return;
    const isUrl = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+/i.test(v);
    addRepos([
      {
        name: v.replace(/^https?:\/\//, ""),
        kind: isUrl ? "Web" : "Scholarly",
        records: 0,
      },
    ]);
    setAddText("");
  };

  const list = k.repos.filter((r) =>
    r.name.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const activeCount = k.repos.filter((r) => r.active).length;
  const counts: Record<Tab, number> = {
    Repositories: k.repos.length,
    "Approved Research": APPROVED.length,
    Methodologies: METHODOLOGIES.length,
    Clips: k.clips.length,
  };

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl leading-[1.2] font-semibold tracking-[-0.02em] text-[#101D37] sm:text-[30px]">
            <span className="text-blue">Knowledge</span> Library
          </h1>
          <p className="text-sm leading-[1.5] text-body">
            The repositories your research draws on. Switch a repository off to
            keep it out of answers.
          </p>
        </div>
        <button
          type="button"
          aria-expanded={adding && tab === "Repositories"}
          onClick={() => {
            if (adding && tab === "Repositories") {
              setAdding(false);
              return;
            }
            setTab("Repositories");
            setAdding(true);
            setTimeout(() => addRef.current?.focus(), 50);
          }}
          className={`flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-sm font-semibold ${
            adding && tab === "Repositories"
              ? "border border-[#EDEDF0] bg-white text-[#101D37] hover:bg-[#F8F9FC]"
              : "bg-blue text-white"
          }`}
        >
          <Icon
            icon={huge(
              adding && tab === "Repositories" ? Cancel01Icon : Add01Icon,
            )}
            size={16}
            stroke={1.8}
          />
          {adding && tab === "Repositories" ? "Close" : "Add Source"}
        </button>
      </div>

      {/* tabs */}
      <div
        role="tablist"
        className="flex gap-6 overflow-x-auto border-b border-[#EDEDF0] [scrollbar-width:none]"
      >
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 pb-3 text-sm font-semibold whitespace-nowrap transition-colors ${
              tab === t
                ? "border-blue text-blue"
                : "border-transparent text-body hover:text-[#101D37]"
            }`}
          >
            {t}
            <span
              className={`rounded-md px-1.5 py-0.5 text-[11px] ${tab === t ? "bg-blue/10" : "bg-[#F2F4F7]"}`}
            >
              {counts[t]}
            </span>
          </button>
        ))}
      </div>

      {notice && (
        <p
          role="status"
          className="w-fit rounded-[10px] bg-[#2BCB23]/10 px-3 py-2 text-sm font-medium text-[#1B8A15]"
        >
          {notice}
        </p>
      )}

      {tab === "Repositories" && (
        <>
          {adding && (
            <section className="grid gap-4 rounded-[20px] border border-[#EDEDF0] bg-[#FAFAFA] p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
              {/* upload */}
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  onFiles(e.dataTransfer.files);
                }}
                className={`flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-[14px] border-2 border-dashed px-6 py-8 text-center transition-colors ${
                  drag
                    ? "border-blue bg-blue/[0.04]"
                    : "border-[#D0D5DD] bg-white hover:border-blue/60"
                }`}
              >
                <span className="flex size-12 items-center justify-center rounded-full bg-blue/10 text-blue">
                  <Icon icon={huge(CloudUploadIcon)} size={24} stroke={1.5} />
                </span>
                <span className="text-base font-semibold text-[#101D37]">
                  Drop files or click to upload
                </span>
                <span className="text-xs text-body">
                  PDF · DOCX · PPTX · CSV · TXT · 25+ types
                </span>
              </button>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                onChange={(e) => onFiles(e.target.files)}
              />

              {/* connectors */}
              <div className="flex min-w-0 flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold tracking-[0.06em] text-body uppercase">
                    Connect data
                  </span>
                  <span className="rounded-md bg-blue/10 px-2 py-0.5 text-[11px] font-semibold text-blue">
                    MCP · Vertical data layers
                  </span>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {k.connectors.map((c) => (
                    <div
                      key={c.id}
                      className="flex min-h-[62px] items-center justify-between gap-2 rounded-[14px] border border-[#EDEDF0] bg-white px-4 py-3"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-[#101D37]">
                          {c.name}
                        </span>
                        <span className="block truncate text-xs text-body">
                          {c.desc}
                        </span>
                      </span>
                      {c.connected ? (
                        <button
                          type="button"
                          title="Click to disconnect"
                          onClick={() =>
                            updateKnowledge((s) => ({
                              connectors: s.connectors.map((x) =>
                                x.id === c.id ? { ...x, connected: false } : x,
                              ),
                            }))
                          }
                          className="shrink-0 rounded-lg bg-[#2BCB23]/10 px-2.5 py-1 text-xs font-semibold text-[#1B8A15] hover:bg-[#F04438]/10 hover:text-[#D92D20]"
                        >
                          Connected
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            updateKnowledge((s) => ({
                              connectors: s.connectors.map((x) =>
                                x.id === c.id ? { ...x, connected: true } : x,
                              ),
                            }));
                            flash(`${c.name} connected.`);
                          }}
                          className="flex h-8 shrink-0 items-center gap-1 rounded-[10px] border border-[#EDEDF0] bg-white px-2.5 text-xs font-semibold text-[#101D37] hover:border-blue hover:text-blue"
                        >
                          <Icon
                            icon={huge(Plug01Icon)}
                            size={14}
                            stroke={1.6}
                          />
                          Connect
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    aria-expanded={moreOpen}
                    onClick={() => setMoreOpen((o) => !o)}
                    className="flex min-h-[62px] items-center justify-center gap-1.5 rounded-[14px] border border-dashed border-[#D0D5DD] bg-white text-sm font-semibold text-blue hover:border-blue"
                  >
                    <Icon icon={huge(Add01Icon)} size={16} stroke={1.8} />
                    {moreOpen ? "Show fewer" : "Browse all"}
                  </button>
                  {moreOpen &&
                    MORE_CONNECTORS.filter(
                      (m) => !k.connectors.some((c) => c.id === m.id),
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          updateKnowledge((s) => ({
                            connectors: [
                              ...s.connectors,
                              { ...m, connected: true },
                            ],
                          }));
                          flash(`${m.name} connected.`);
                        }}
                        className="flex min-h-[62px] items-center justify-between gap-2 rounded-[14px] border border-[#EDEDF0] bg-white px-4 py-3 text-left hover:border-blue"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-[#101D37]">
                            {m.name}
                          </span>
                          <span className="block truncate text-xs text-body">
                            {m.desc}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs font-semibold text-blue">
                          Connect
                        </span>
                      </button>
                    ))}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    addByName();
                  }}
                  className="flex gap-2"
                >
                  <input
                    ref={addRef}
                    value={addText}
                    onChange={(e) => setAddText(e.target.value)}
                    placeholder="Or add a repository by name or web address"
                    aria-label="Repository name or web address"
                    className="h-10 min-w-0 flex-1 rounded-[10px] border border-[#EDEDF0] bg-white px-3 text-sm text-[#101D37] outline-none placeholder:text-body focus:border-blue"
                  />
                  <button
                    type="submit"
                    disabled={!addText.trim()}
                    className="h-10 shrink-0 rounded-[10px] bg-blue px-4 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    Add
                  </button>
                </form>
              </div>
            </section>
          )}

          <section className={CARD}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className={H2}>Repositories</h2>
                <p className="text-xs text-body">
                  {activeCount} of {k.repos.length} used in answers
                </p>
              </div>
              <label className="flex h-9 w-full items-center gap-2 rounded-[10px] border border-[#EDEDF0] bg-white px-3 sm:w-[260px]">
                <Icon
                  icon={huge(Search01Icon)}
                  size={14}
                  stroke={1.4}
                  className="shrink-0 text-body"
                />
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search repositories"
                  aria-label="Search repositories"
                  className="w-full min-w-0 bg-transparent text-sm text-[#101D37] outline-none placeholder:text-body"
                />
              </label>
            </div>
            <div className="-mx-5 overflow-x-auto px-5">
              <div className="flex min-w-[720px] flex-col gap-2">
                <div
                  className={`${GRID} px-4 text-xs font-semibold tracking-[0.04em] text-body uppercase`}
                >
                  <span>Repository name</span>
                  <span>Status</span>
                  <span>Last used</span>
                  <span>Records</span>
                  <span>Date added</span>
                  <span />
                </div>
                {list.length === 0 && (
                  <p className="rounded-[12px] border border-[#EDEDF0] px-4 py-6 text-center text-sm text-body">
                    No repositories match “{q}”.
                  </p>
                )}
                {list.map((r) => (
                  <div
                    key={r.id}
                    className={`${GRID} min-h-[52px] rounded-xl border border-[#EDEDF0] bg-white px-4 py-2 ${r.active ? "" : "bg-[#FCFCFD]"}`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        title={r.name}
                        className={`truncate text-sm font-semibold ${r.active ? "text-[#101D37]" : "text-body"}`}
                      >
                        {r.name}
                      </span>
                      <span
                        className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${KIND_STYLE[r.kind]}`}
                      >
                        {r.kind}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Switch
                        on={r.active}
                        label={`${r.active ? "Exclude" : "Include"} ${r.name}`}
                        onChange={(v) =>
                          updateKnowledge((s) => ({
                            repos: s.repos.map((x) =>
                              x.id === r.id ? { ...x, active: v } : x,
                            ),
                          }))
                        }
                      />
                      <span
                        className={`text-xs font-medium ${r.active ? "text-[#1B8A15]" : "text-body"}`}
                      >
                        {r.active ? "Active" : "Inactive"}
                      </span>
                    </span>
                    <span className="text-sm text-body">{r.lastUsed}</span>
                    <span className="text-sm font-medium text-[#101D37]">
                      {r.records}
                    </span>
                    <span className="text-sm text-body">{r.added}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${r.name}`}
                      title="Remove"
                      onClick={() =>
                        updateKnowledge((s) => ({
                          repos: s.repos.filter((x) => x.id !== r.id),
                        }))
                      }
                      className="flex size-8 items-center justify-center rounded-[10px] text-body hover:bg-[#FEF3F2] hover:text-[#D92D20]"
                    >
                      <Icon icon={huge(Delete02Icon)} size={16} stroke={1.5} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      )}

      {tab === "Approved Research" && (
        <section className={CARD}>
          <h2 className={H2}>Approved Research</h2>
          <p className="-mt-2 text-xs text-body">
            Research signed off by a reviewer. Its claims can be reused as
            trusted evidence.
          </p>
          <ul className="flex flex-col gap-2">
            {APPROVED.map((a) => (
              <li
                key={a.title}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[#EDEDF0] bg-white px-4 py-3"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-blue/10 text-blue">
                    <Icon icon={huge(BookOpen01Icon)} size={18} stroke={1.5} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[#101D37]">
                      {a.title}
                    </span>
                    <span className="block truncate text-xs text-body">
                      {a.project} · Approved by {a.approvedBy} · {a.date}
                    </span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-body">{a.claims} claims</span>
                  <span className="flex items-center gap-1 rounded-lg bg-[#2BCB23]/10 px-2 py-1 text-xs font-semibold text-[#1B8A15]">
                    <Icon
                      icon={huge(CheckmarkBadge01Icon)}
                      size={14}
                      stroke={1.6}
                    />
                    Approved
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "Methodologies" && (
        <section className={CARD}>
          <h2 className={H2}>Methodologies</h2>
          <p className="-mt-2 text-xs text-body">
            Organization-defined research approaches and review requirements.
            Apply one or several to a whole research or to a single question.
          </p>
          <div className="-mx-5 overflow-x-auto px-5">
            <div className="flex min-w-[600px] flex-col gap-2">
              <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_70px] gap-3 px-4 text-xs font-semibold tracking-[0.04em] text-body uppercase">
                <span>Methodology</span>
                <span>Used for</span>
                <span>Stages</span>
              </div>
              {METHODOLOGIES.map((m) => (
                <div
                  key={m.name}
                  className="grid min-h-[52px] grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_70px] items-center gap-3 rounded-xl border border-[#EDEDF0] bg-white px-4 py-2"
                >
                  <span className="text-sm font-semibold text-[#101D37]">
                    {m.name}
                  </span>
                  <span className="text-sm text-body">{m.usedFor}</span>
                  <span className="text-sm font-medium text-[#101D37]">
                    {m.stages}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {tab === "Clips" && (
        <section className={CARD}>
          <h2 className={H2}>Clips</h2>
          <p className="-mt-2 text-xs text-body">
            Passages saved from sources while researching.
          </p>
          {k.clips.length === 0 && (
            <p className="text-sm text-body">No clips saved yet.</p>
          )}
          <ul className="grid gap-3 md:grid-cols-2">
            {k.clips.map((c) => (
              <li
                key={c.id}
                className="flex flex-col gap-3 rounded-[14px] border border-[#EDEDF0] bg-[#FAFAFA] p-4"
              >
                <span className="text-blue">
                  <Icon icon={huge(QuoteDownIcon)} size={20} stroke={1.5} />
                </span>
                <p className="text-sm leading-[1.6] text-[#101D37]">{c.text}</p>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-body">
                    {c.source} · {c.project} · {c.saved}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      updateKnowledge((s) => ({
                        clips: s.clips.filter((x) => x.id !== c.id),
                      }))
                    }
                    className="text-xs font-semibold text-body hover:text-[#D92D20]"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
