"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Folder, Signal01 } from "@untitledui/icons";
import {
  Add01Icon, ArrowDown01Icon, ArrowUpRight01Icon, Calendar03Icon, MoonEclipseIcon, RepeatIcon,
} from "@hugeicons/core-free-icons";
import TopBar from "@/components/v2/dashboard/TopBar";
import AreaChart from "@/components/v2/dashboard/AreaChart";
import Icon, { huge, untitled, type AnyIcon } from "@/components/v2/dashboard/Icon";
import AskComposer from "@/components/v2/ask/AskComposer";
import { useProjects } from "@/components/v2/V2Frame";
import { api } from "@/lib/api";
import type { EvidenceScope } from "@/lib/types";
import { pending, prefs } from "@/lib/v2/ask";
import { V2 } from "@/lib/v2/routes";

/*
 * Design: app/(dashboard)/home/page.tsx. The ask box is real: a question goes into the chosen project as a new chat
 * and opens the chat page, where it is answered with live steps. The three lists and the Analytics charts have no
 * backend yet and keep the design's sample content (placeholder.md).
 */
const COLUMNS: { title: string; icon: AnyIcon; items: string[] }[] = [
  {
    title: "Priority Intelligence Briefing",
    icon: untitled(Folder),
    items: ["Financial plan — baseline and scenarios", "Financial and delivery risk assessment", "Commercial Viability"],
  },
  {
    title: "Active Initiatives",
    icon: huge(MoonEclipseIcon),
    items: ["Industrial Heat Recovery — Sample Pilot", "Hydrogen Energy Feasibility", "Industrial Reliability Program"],
  },
  {
    title: "Monitoring Coverage",
    icon: untitled(Signal01),
    items: ["Industrial Heat Recovery — Sample Pilot", "Hydrogen Energy Feasibility", "Industrial Reliability Program"],
  },
];

function SmallButton({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex size-[26.78px] items-center justify-center rounded-lg border-[0.84px] border-[#EDEDF0] bg-white text-body"
    >
      {children}
    </button>
  );
}

function ChartCard({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[13.39px] rounded-[20px] border-[0.84px] border-[#EDEDF0] bg-white p-5">
      <div>
        <h3 className="text-base leading-[1.5] font-medium tracking-[-0.02em] text-[#101D37]">{title}</h3>
        <p className="text-sm leading-[1.5] tracking-[-0.02em] text-body">{subtitle}</p>
      </div>
      <AreaChart />
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const { projects, loading, error: loadError } = useProjects();
  // Closed-repository projects ask through approved research tasks, so only open-discovery projects take questions.
  const options = useMemo(
    () => projects.filter((p) => p.mode === "open_discovery").map((p) => ({ value: p.id, label: p.name })),
    [projects],
  );
  const [projectId, setProjectId] = useState<string | null>(null);
  const [scope, setScope] = useState<EvidenceScope>("both");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setScope(prefs.scope()), []);
  useEffect(() => {
    // the last project used in this browser, if it still exists and takes questions; else the first that does
    if (projectId && options.some((o) => o.value === projectId)) return;
    const saved = prefs.project();
    setProjectId(options.find((o) => o.value === saved)?.value ?? options[0]?.value ?? null);
  }, [options, projectId]);

  const ask = async (question: string) => {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      const chat = await api.createChat(projectId, question.slice(0, 120));
      pending.put(chat.id, question, scope);
      router.push(`${V2}/projects/${projectId}/ask/${chat.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the chat.");
      setBusy(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <TopBar current="Home" />

      <main className="px-4 pt-10 pb-16 sm:px-6 lg:px-10">
        <div className="mx-auto flex w-full max-w-[964px] flex-col gap-[30px]">
          <h1 className="text-center text-2xl leading-[1.2] font-semibold tracking-[-0.02em] text-[#101D37] sm:text-[30px]">
            What Would You <span className="text-blue">Like To Investigate?</span>
          </h1>

          <div className="flex flex-col gap-2">
            <AskComposer
              projectId={projectId}
              projects={options}
              onProjectChange={(id) => { setProjectId(id); prefs.setProject(id); }}
              onCreateProject={() => router.push(`${V2}/projects/new`)}
              scope={scope}
              onScopeChange={(s) => { setScope(s); prefs.setScope(s); }}
              busy={busy || loading}
              onAsk={(q) => void ask(q)}
            />
            {(error || loadError) && (
              <p role="alert" className="text-sm text-[#B42318]">{error ?? `Could not load projects: ${loadError}`}</p>
            )}
            {!loading && !loadError && options.length === 0 && (
              <p className="text-sm text-body">
                No project can take questions yet. Questions need an open-discovery project.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-[30px] md:grid-cols-3">
            {COLUMNS.map(({ title, icon, items }) => (
              <section key={title} className="flex flex-col gap-4">
                <h2 className="text-base leading-[1.5] font-medium tracking-[-0.02em] text-[#101D37]">{title}</h2>
                <ul className="flex flex-col gap-3">
                  {items.map((item, i) => (
                    <li key={item} className="flex flex-col gap-3">
                      {i > 0 && <div className="h-px w-full bg-[#EDEDF0]" />}
                      <a
                        href="#"
                        className="group flex items-center gap-1.5 text-sm leading-[1.5] tracking-[-0.02em] text-body hover:text-[#101D37]"
                      >
                        <Icon icon={icon} size={16} className="shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{item}</span>
                        <Icon icon={huge(ArrowUpRight01Icon)} size={16} className="shrink-0" />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          {/* Analytics hidden for now
          <div className="h-px w-full bg-[#EDEDF0]" />

          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl leading-[1.5] font-semibold tracking-[-0.02em] text-[#101D37]">Analytics</h2>
            <div className="flex items-center gap-2">
              <SmallButton label="Add widget">
                <Icon icon={huge(Add01Icon)} size={13} stroke={1.1} />
              </SmallButton>
              <SmallButton label="Switch view">
                <Icon icon={huge(RepeatIcon)} size={13} stroke={1.1} />
              </SmallButton>
              <button
                type="button"
                className="flex h-[26.78px] items-center gap-[3.35px] rounded-lg border-[0.84px] border-[#EDEDF0] bg-white px-[10.04px] py-[6.69px] text-[11.72px] leading-[1.5] tracking-[-0.02em] text-body"
              >
                <Icon icon={huge(Calendar03Icon)} size={13} stroke={1.1} />
                Last 4 Weeks
                <Icon icon={huge(ArrowDown01Icon)} size={13} stroke={1.1} />
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-4 md:flex-row">
            <ChartCard title="Research Activity Overview" subtitle="Research items created over time" />
            <ChartCard title="Research Item Status" subtitle="Research items created over time" />
          </div>
          */}
        </div>
      </main>
    </div>
  );
}
