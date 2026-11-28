"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useProjects } from "@/components/v2/V2Frame";
import { ModelLogo } from "@/components/v2/knowledge/ModelLogos";
import { reportToMarkdown } from "@/lib/evidenceReport";
import type { EvidenceDetail, EvidenceFilter, EvidenceItem, EvidenceLibrary as Library, EvidenceRun } from "@/lib/types";
import { V2 } from "@/lib/v2/routes";

const ORIGIN_LABEL: Record<string, string> = {
  user_upload: "Uploaded PDF",
  openalex: "OpenAlex",
  europe_pmc: "Europe PMC",
  unpaywall: "Unpaywall",
};

const RUN_CHIP: Record<string, { label: string; cls: string }> = {
  not_started: { label: "Not started", cls: "bg-[#F2F4F7] text-[#344054]" },
  queued: { label: "Queued", cls: "bg-[#F2F4F7] text-[#344054]" },
  running: { label: "Researching", cls: "bg-[#EFF8FF] text-[#1849A9]" },
  complete: { label: "Complete", cls: "bg-[#ECFDF3] text-[#067647]" },
  failed: { label: "Failed", cls: "bg-[#FEF3F2] text-[#B42318]" },
  waiting: { label: "Waiting for sources", cls: "bg-[#FFFAEB] text-[#B54708]" },
};

const Chip = ({ cls, children }: { cls: string; children: ReactNode }) => (
  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{children}</span>
);

const isActive = (r: EvidenceRun) => r.status === "queued" || r.status === "running";

export default function EvidenceLibrary({ id }: { id: string }) {
  const router = useRouter();
  const { projects, loading: projectsLoading } = useProjects();
  const project = projects.find((p) => p.id === id || p.slug === id);
  // The header name must not depend on the shared projects list alone: if that list settles without this
  // project (or fails), fetch the project itself — the same id-or-slug the evidence call uses.
  const [directName, setDirectName] = useState<string | null>(null);
  useEffect(() => {
    if (project || projectsLoading) return;
    let live = true;
    api.project(id).then((p) => { if (live) setDirectName(p.name); }).catch(() => { /* keep "…" */ });
    return () => { live = false; };
  }, [project, projectsLoading, id]);
  const projectName = project?.name ?? directName;
  const [filter, setFilter] = useState<EvidenceFilter>({});
  const [onlyWp, setOnlyWp] = useState<string | null>(null);
  useEffect(() => {
    // read the sidebar's choice after mount (keeps server and browser markup the same)
    setOnlyWp(new URLSearchParams(window.location.search).get("work_package"));
  }, []);
  const [data, setData] = useState<Library | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<EvidenceItem | null>(null);
  const [detail, setDetail] = useState<EvidenceDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api.projectEvidence(id, filter)
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the evidence."));
  }, [id, filter]);

  useEffect(() => { load(); }, [load]);

  // While any work package is still being researched, refresh until every run has finished.
  const active = data?.runs.some(isActive) ?? false;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [active, load]);

  useEffect(() => {
    if (!open) { setDetail(null); return; }
    let live = true;
    api.evidenceDetail(open.task_id, open.id)
      .then((d) => { if (live) setDetail(d); })
      .catch(() => { if (live) setDetail(null); });
    return () => { live = false; };
  }, [open]);

  /* The gate report for one work package, saved as a Markdown file. Built in the browser from the report data. */
  const downloadReport = async (taskId: string, code?: string | null) => {
    try {
      const report = await api.taskReport(taskId);
      const url = URL.createObjectURL(new Blob([reportToMarkdown(report)], { type: "text/markdown" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `gate-report-${(code ?? "work-package").toLowerCase()}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the gate report.");
    }
  };

  const runAgain = async (taskId: string) => {
    setBusy(taskId);
    try {
      await api.runTaskEvidence(taskId);
    } catch (e) {
      // The run did not start: stay here and show why, do not go to Home.
      setError(e instanceof Error ? e.message : "Could not start the research.");
      return;
    } finally {
      setBusy(null);
    }
    // The run is now going on the server: open the Home tab, same browser tab,
    // carrying the run's identity so Home can show the research in progress.
    router.push(`${V2}/home?running=${taskId}&project=${id}`);
  };

  // Opened from one work package's sidebar (?work_package=<task id>): everything below is that package only.
  // The id is honoured only when the loaded data actually has that run. Before the first load settles there is
  // no run to match, so scoping then would show literal 0s, "No work packages yet" and an empty filter — the
  // false-empty library. A stale or wrong id (the sidebar can link another work package) did the same after
  // load, hiding the project's real evidence; then the full library is shown, with a note.
  const loaded = data !== null;
  const scoped = onlyWp !== null && loaded && (data?.runs ?? []).some((r) => r.task_id === onlyWp);
  const scopedMiss = onlyWp !== null && loaded && !scoped;
  const allRuns = data?.runs ?? [];
  const runs = scoped ? allRuns.filter((r) => r.task_id === onlyWp) : allRuns;
  const selectedCode = scoped ? allRuns.find((r) => r.task_id === onlyWp)?.code : undefined;
  const models = data?.models ?? {};
  const measurements = (data?.measurements ?? []).filter((m) => !scoped || m.work_package_code === selectedCode);
  const items = scoped ? (data?.items ?? []).filter((it) => it.task_id === onlyWp) : (data?.items ?? []);
  const summary = scoped
    ? { total_sources: runs[0]?.sources ? runs[0].sources.papers + runs[0].sources.uploads : 0,
        claims_supported: items.filter((it) => it.status === "verified").length,
        need_verification: items.filter((it) => it.status === "pending").length }
    : data?.summary;

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Evidence library" className="rounded-[20px] border border-[#EDEDF0] bg-[#FAFAFA] p-5">
        <div className="rounded-2xl bg-[#EFF5FF] px-6 py-5 text-center">
          <p className="text-xs font-medium tracking-wide text-body uppercase">Evidence library</p>
          <h2 className="mt-1 text-xl font-semibold text-dark">Project: {projectName ?? "…"}</h2>
          <p className="mt-1 text-sm text-body">Research evidence for each work package</p>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label="Total sources" value={summary?.total_sources} />
          <Stat label="Claims supported" value={summary?.claims_supported} />
          <Stat label="Need verification" value={summary?.need_verification} />
        </div>

        {error && <p role="alert" className="mt-4 text-sm text-[#B42318]">{error}</p>}

        {scopedMiss && (
          <p role="status" className="mt-4 text-sm text-body">
            That work package isn't in this project — showing all of the project's evidence.
          </p>
        )}

        <h3 className="mt-6 text-sm font-semibold text-[#101D37]">Work packages</h3>
        {!loaded ? (
          error ? null : <p className="mt-2 text-sm text-body">Loading evidence…</p>
        ) : runs.length === 0 ? (
          <p className="mt-2 text-sm text-body">No work packages yet. Add one from the project overview, and its research starts there.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {runs.map((r) => {
              const chip = RUN_CHIP[r.status] ?? RUN_CHIP.queued;
              return (
                <li key={r.task_id} className="flex flex-wrap items-center gap-3 rounded-xl border border-[#EDEDF0] bg-white p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[#101D37]">
                      {r.code ? `${r.code} · ` : ""}{r.work_package_title ?? "Work package"}
                    </p>
                    {r.statement && <p className="mt-0.5 line-clamp-2 text-xs text-body">{r.statement}</p>}
                    {r.status === "failed" && r.error && <p className="mt-0.5 text-xs text-[#B42318]">{r.error}</p>}
                  </div>
                  <Chip cls={chip.cls}>{chip.label}</Chip>
                  <span className="text-xs text-body">{r.papers_read ?? 0} papers read</span>
                  {r.sources && (
                    <span className="text-xs text-body">{r.sources.papers} papers · {r.sources.uploads} uploads</span>
                  )}
                  <button
                    type="button"
                    onClick={() => void downloadReport(r.task_id, r.code)}
                    className="rounded-[10px] border border-[#EDEDF0] bg-white px-3 py-1.5 text-xs font-semibold text-[#344054] hover:border-[#D0D5DD]"
                  >
                    Gate report
                  </button>
                  {!isActive(r) && (
                    <button
                      type="button"
                      onClick={() => runAgain(r.task_id)}
                      disabled={busy === r.task_id}
                      className="rounded-[10px] border border-[#EDEDF0] bg-white px-3 py-1.5 text-xs font-semibold text-[#344054] hover:border-[#D0D5DD] disabled:opacity-60"
                    >
                      {r.status === "complete" ? "Run again" : r.status === "not_started" ? "Start research" : "Retry"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label="Filter evidence" className="rounded-[20px] border border-[#EDEDF0] bg-[#FAFAFA] p-5">
        <h3 className="text-sm font-semibold text-[#101D37]">Filter evidence</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <input
            type="search"
            aria-label="Search evidence"
            placeholder="Search evidence, keywords, or source title..."
            value={filter.q ?? ""}
            onChange={(e) => setFilter({ ...filter, q: e.target.value })}
            className="h-10 min-w-0 rounded-[10px] border border-[#EDEDF0] bg-white px-3 text-sm text-[#101D37] outline-none placeholder:text-body focus:border-blue md:col-span-2 xl:col-span-2"
          />
          <select aria-label="Work package" value={filter.work_package ?? ""} onChange={(e) => setFilter({ ...filter, work_package: e.target.value || undefined })}
            className="h-10 rounded-[10px] border border-[#EDEDF0] bg-white px-3 text-sm text-[#101D37] outline-none focus:border-blue">
            <option value="">All work packages</option>
            {runs.map((r) => <option key={r.task_id} value={r.task_id}>{r.code ? `${r.code} · ` : ""}{r.work_package_title}</option>)}
          </select>
          <select aria-label="Model" value={filter.model ?? ""} onChange={(e) => setFilter({ ...filter, model: e.target.value || undefined })}
            className="h-10 rounded-[10px] border border-[#EDEDF0] bg-white px-3 text-sm text-[#101D37] outline-none focus:border-blue">
            <option value="">All models</option>
            {(Object.keys(models) as ("model_a" | "model_b")[]).map((k) => <option key={k} value={k}>{models[k]?.label}</option>)}
          </select>
          <select aria-label="Status" value={filter.status ?? ""} onChange={(e) => setFilter({ ...filter, status: e.target.value || undefined })}
            className="h-10 rounded-[10px] border border-[#EDEDF0] bg-white px-3 text-sm text-[#101D37] outline-none focus:border-blue">
            <option value="">All statuses</option>
            <option value="verified">Verified</option>
            <option value="pending">Pending verification</option>
          </select>
        </div>
      </section>

      {measurements.length > 0 && (
        <section aria-label="Measurements" className="rounded-[20px] border border-[#EDEDF0] bg-[#FAFAFA] p-5">
          <h3 className="text-sm font-semibold text-[#101D37]">Measurements with units ({measurements.length})</h3>
          <table className="mt-3 w-full text-left text-sm">
            <thead><tr className="border-b border-[#EDEDF0] text-xs text-[#667085]">
              <th className="py-2 font-medium">Value</th><th className="py-2 font-medium">Work package</th>
              <th className="py-2 font-medium">Evidence</th><th className="py-2 font-medium">Source</th>
            </tr></thead>
            <tbody>{measurements.map((m, i) => (
              <tr key={`${m.evidence_id}-${m.text}-${i}`} className="border-b border-[#EDEDF0] last:border-0">
                <td className="py-2 font-medium text-[#101D37]">{m.text}</td>
                <td className="py-2 text-[#344054]">{m.work_package_code ?? "—"}</td>
                <td className="py-2 text-[#344054]">{m.evidence_id ?? "—"}</td>
                <td className="py-2 text-[#344054]">{m.source_title ?? "Untitled"}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}

      <section aria-label="Evidence records" className="rounded-[20px] border border-[#EDEDF0] bg-[#FAFAFA] p-5">
        <h3 className="text-sm font-semibold text-[#101D37]">Evidence records</h3>
        {!loaded ? (
          error ? null : <p className="mt-3 text-sm text-body">Loading evidence records…</p>
        ) : items.length === 0 ? (
          <p className="mt-3 text-sm text-body">
            {runs.some(isActive) ? "Researching the work packages. Evidence appears here when it is ready." : "No evidence matches these filters."}
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {items.map((it) => (
              <li key={it.id} aria-label={it.evidence_id} className="rounded-2xl border border-[#EDEDF0] bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-[#101D37]">{it.evidence_id}</p>
                  {it.status === "verified"
                    ? <Chip cls="bg-[#ECFDF3] text-[#067647]">Verified</Chip>
                    : <Chip cls="bg-[#FFFAEB] text-[#B54708]">Pending verification</Chip>}
                </div>
                <p className="mt-1 text-xs text-body">
                  {it.work_package_code ? `${it.work_package_code} · ` : ""}{it.work_package_title ?? "Work package"}
                </p>
                <p className="mt-2 text-sm text-[#101D37]"><span className="font-semibold">Source title:</span> {it.source_title ?? "Untitled"}</p>
                <p className="mt-1 text-sm text-[#344054]"><span className="font-semibold">Supporting claim:</span> {it.claim_text}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {it.found_by.map((m) => (
                    <span key={m} className="inline-flex items-center gap-1.5 rounded-full bg-[#F2F4F7] px-2 py-0.5 text-xs text-[#344054]">
                      <ModelLogo model={models[m]?.label ?? m} size={14} />{models[m]?.label ?? m}
                    </span>
                  ))}
                  {it.origin && <span className="rounded-full bg-[#F2F4F7] px-2 py-0.5 text-xs text-[#344054]">{ORIGIN_LABEL[it.origin] ?? it.origin}</span>}
                </div>
                <p className="mt-2 text-xs text-body">
                  {it.source_url
                    ? <a href={it.source_url} target="_blank" rel="noreferrer" className="text-blue underline">{it.doi ? `doi:${it.doi}` : "Source link"}</a>
                    : "No link"}
                  {" · "}{it.pub_year ? `Published ${it.pub_year}` : "Publication year unknown"}
                  {" · "}{it.created_at ? `Added ${new Date(it.created_at).toLocaleDateString()}` : ""}
                </p>
                <button type="button" onClick={() => setOpen(it)}
                  className="mt-3 w-full rounded-[10px] border border-[#EDEDF0] bg-white px-4 py-2 text-sm font-medium text-[#344054] hover:border-[#D0D5DD]">
                  View evidence details →
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {open && (
        <div role="dialog" aria-modal="true" aria-label={`${open.evidence_id} details`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#101D37]/40 p-4" onClick={() => setOpen(null)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-[20px] bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-lg font-semibold text-[#101D37]">{open.evidence_id}</h2>
              <button type="button" onClick={() => setOpen(null)} className="text-sm text-body hover:text-[#101D37]">Close</button>
            </div>
            <p className="mt-3 text-sm text-[#344054]"><span className="font-semibold">Supporting claim:</span> {open.claim_text}</p>
            {open.quote && <blockquote className="mt-3 border-l-2 border-blue pl-3 text-sm text-[#344054]">“{open.quote}”</blockquote>}
            {detail?.statement && (
              <p className="mt-4 rounded-xl bg-[#FAFAFA] p-3 text-sm text-[#344054]"><span className="font-semibold">Judge:</span> {detail.statement}</p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {(Object.keys(detail?.models ?? models) as ("model_a" | "model_b")[]).map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5 rounded-full bg-[#F2F4F7] px-2.5 py-1 text-xs text-[#344054]">
                  <ModelLogo model={(detail?.models ?? models)[k]?.label ?? k} size={14} />
                  {(detail?.models ?? models)[k]?.label ?? k}
                  {open.found_by.includes(k) ? " · found it" : ""}
                </span>
              ))}
            </div>
            <h3 className="mt-5 text-sm font-semibold text-[#101D37]">Passages it cites</h3>
            {detail ? (
              detail.passages.length ? (
                <ul className="mt-2 flex flex-col gap-2">
                  {detail.passages.map((p) => (
                    <li key={p.chunk_id} className="rounded-xl border border-[#EDEDF0] p-3">
                      <p className="text-xs text-body">
                        {p.source_title ?? "Untitled"}{p.page_start ? ` · page ${p.page_start}` : ""} · seal {p.sha256.slice(0, 12)}…
                      </p>
                      <p className="mt-1 text-sm text-[#344054]">{p.text}</p>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-sm text-body">No passage text is stored for this item.</p>
            ) : <p className="mt-2 text-sm text-body">Loading passages…</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-2xl border border-[#EDEDF0] bg-white p-4">
      <p className="text-2xl font-semibold text-[#101D37]">{value ?? "–"}</p>
      <p className="mt-1 text-xs text-body">{label}</p>
    </div>
  );
}
