"use client";

import Link from "next/link";
import { V2 } from "@/lib/v2/routes";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Database01, SearchMd, XClose } from "@untitledui/icons";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import Icon, { huge, untitled } from "@/components/v2/dashboard/Icon";
import { LogoPair } from "./ModelLogos";
import {
  MODEL_PANELS,
  panelFor,
  REASONING,
  updateKnowledge,
  useKnowledge,
} from "@/lib/v2/design/knowledge";

/** Small on/off switch (blue when on) */
export function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-blue" : "bg-[#D0D5DD]"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : ""}`}
      />
    </button>
  );
}

/** Button + floating panel; closes on outside click and Escape. */
function Dropdown({
  label,
  icon,
  children,
  up,
  width = 360,
  plain,
  ariaLabel,
}: {
  label: ReactNode;
  icon?: ReactNode;
  children: (close: () => void) => ReactNode;
  up?: boolean;
  width?: number;
  /** text-only trigger, no border (like Claude's effort selector) */
  plain?: boolean;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  /* The panel floats over the page (position: fixed), so it can never make the page taller.
   * It opens on the side with more room, stays inside the window, scrolls inside when long,
   * and follows the button when the page scrolls or resizes. */
  const [place, setPlace] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    maxH: number;
  } | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const measure = () => {
      if (!panel.current || !ref.current) return;
      const btn = ref.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const natural = panel.current.scrollHeight;
      const GAP = 8;
      const EDGE = 12;
      const below = vh - btn.bottom - GAP - EDGE;
      /* keep clear of the sticky top bar (64px) */
      const above = btn.top - GAP - Math.max(EDGE, 72);
      const goUp = up
        ? natural <= above || above >= below
        : natural > below && above > below;
      const w = Math.min(width, vw - 2 * EDGE);
      const left = Math.max(EDGE, Math.min(btn.left, vw - w - EDGE));
      setPlace(
        goUp
          ? { bottom: vh - btn.top + GAP, left, maxH: Math.max(160, above) }
          : { top: btn.bottom + GAP, left, maxH: Math.max(160, below) },
      );
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, up, width]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-sm leading-[1.5] tracking-[-0.02em] transition-colors ${
          plain
            ? open
              ? "bg-[#F2F4F7] text-[#101D37]"
              : "text-body hover:bg-[#F2F4F7] hover:text-[#101D37]"
            : open
              ? "border border-blue bg-blue/[0.04] text-[#101D37]"
              : "border border-[#EDEDF0] bg-white text-body hover:border-[#D0D5DD] hover:text-[#101D37]"
        }`}
      >
        {icon}
        <span className="whitespace-nowrap">{label}</span>
        <Icon
          icon={huge(ArrowDown01Icon)}
          size={16}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          ref={panel}
          role="dialog"
          className="fixed z-50 flex flex-col overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl [&>*]:shrink-0 border border-[#EDEDF0] bg-white shadow-[0_14px_30px_0_rgba(16,29,55,0.14)]"
          style={{
            width: `min(${width}px, calc(100vw - 24px))`,
            top: place?.top,
            bottom: place?.bottom,
            left: place?.left ?? -9999,
            maxHeight: place?.maxH,
            visibility: place ? "visible" : "hidden",
          }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function SectionHead({ children }: { children: ReactNode }) {
  return (
    <p className="px-4 pt-3 pb-1.5 text-[11px] font-semibold tracking-[0.06em] text-body uppercase">
      {children}
    </p>
  );
}

/** Knowledge Library sources with a search box (like Claude's project picker). */
function RepoList() {
  const k = useKnowledge();
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const shown = query
    ? k.repos.filter(
        (r) =>
          r.name.toLowerCase().includes(query) ||
          r.kind.toLowerCase().includes(query),
      )
    : k.repos;
  return (
    <>
      <div className="px-3 pb-2">
        <label className="flex h-9 items-center gap-2 rounded-[10px] border border-[#EDEDF0] bg-[#FAFAFA] px-2.5 focus-within:border-blue focus-within:bg-white">
          <Icon
            icon={untitled(SearchMd)}
            size={15}
            className="shrink-0 text-body"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && q) {
                e.stopPropagation();
                setQ("");
              }
            }}
            placeholder="Search sources"
            aria-label="Search Knowledge Library sources"
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-[#101D37] outline-none placeholder:text-body"
          />
          {q && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQ("")}
              className="shrink-0 text-body hover:text-[#101D37]"
            >
              <Icon icon={untitled(XClose)} size={14} />
            </button>
          )}
        </label>
      </div>
      <ul className="flex flex-col px-2 pb-2">
        {shown.length === 0 && (
          <li className="px-2 py-3 text-sm text-body">
            No sources match “{q.trim()}”.
          </li>
        )}
        {shown.map((r) => (
          <li key={r.id}>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-[10px] px-2 py-2 hover:bg-[#F8F9FC]">
              <input
                type="checkbox"
                checked={r.active}
                onChange={(e) =>
                  updateKnowledge((s) => ({
                    repos: s.repos.map((x) =>
                      x.id === r.id ? { ...x, active: e.target.checked } : x,
                    ),
                  }))
                }
                className="size-4 shrink-0 cursor-pointer accent-blue"
              />
              <span className="min-w-0 flex-1 truncate text-sm text-[#101D37]">
                {r.name}
              </span>
              <span className="shrink-0 text-xs text-body">{r.records}</span>
            </label>
          </li>
        ))}
      </ul>
    </>
  );
}

/** "Sources · Uploads + online" – which evidence the research may use. */
export function SourcesPicker({ up }: { up?: boolean }) {
  const k = useKnowledge();
  const active = k.repos.filter((r) => r.active);
  const parts = [
    k.useUploads && "Uploads",
    k.useOnline && "online",
    active.length && `${active.length} repos`,
  ].filter(Boolean);
  return (
    <Dropdown
      up={up}
      icon={<Icon icon={untitled(Database01)} size={16} />}
      label={
        <>
          Sources{" "}
          <span className="text-body">
            · {parts.length ? parts.join(" + ") : "none"}
          </span>
        </>
      }
    >
      {() => (
        <>
          <div className="border-b border-[#EDEDF0] px-4 py-3">
            <p className="text-sm font-semibold text-[#101D37]">
              Evidence sources
            </p>
            <p className="text-xs text-body">
              Answers cite the exact passage they came from.
            </p>
          </div>
          <div className="flex flex-col gap-1 px-2 py-2">
            {[
              {
                k: "useUploads" as const,
                name: "Uploaded files",
                desc: "Documents added to this workspace",
              },
              {
                k: "useOnline" as const,
                name: "Search online",
                desc: "Live web, journals and patents",
              },
            ].map((o) => (
              <div
                key={o.k}
                className="flex items-center justify-between gap-3 rounded-[10px] px-2 py-2 hover:bg-[#F8F9FC]"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-[#101D37]">
                    {o.name}
                  </span>
                  <span className="block text-xs text-body">{o.desc}</span>
                </span>
                <Switch
                  on={k[o.k]}
                  label={o.name}
                  onChange={(v) => updateKnowledge(() => ({ [o.k]: v }))}
                />
              </div>
            ))}
          </div>
          <SectionHead>Knowledge Library</SectionHead>
          <RepoList />
          <Link
            href={`${V2}/knowledge`}
            className="flex items-center justify-between border-t border-[#EDEDF0] px-4 py-3 text-sm font-semibold text-blue hover:bg-blue/[0.04]"
          >
            Manage Knowledge Library
            <Icon icon={huge(ArrowRight01Icon)} size={16} stroke={1.8} />
          </Link>
        </>
      )}
    </Dropdown>
  );
}

/** "Panel · 2 models" – which models research and cross-check the answer. */
export function ModelsPicker({ up }: { up?: boolean }) {
  const k = useKnowledge();
  const panel = panelFor(k.panel);
  return (
    <Dropdown
      up={up}
      width={440}
      icon={<LogoPair models={panel.models} size={20} />}
      label={
        <>
          Panel{" "}
          <span className="text-body">· {panel.models.length} models</span>
        </>
      }
    >
      {(close) => (
        <>
          <div className="border-b border-[#EDEDF0] px-4 py-3">
            <p className="text-sm font-semibold text-[#101D37]">
              Research panel
            </p>
            <p className="text-xs text-body">
              The first model answers; the second takes over if it is busy.
            </p>
          </div>
          <div
            role="radiogroup"
            aria-label="Model panel"
            className="flex flex-col gap-2 p-3"
          >
            {MODEL_PANELS.map((p) => {
              const on = p.id === panel.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!p.available}
                  title={p.available ? undefined : "Not connected yet"}
                  onClick={() => updateKnowledge(() => ({ panel: p.id }))}
                  className={`flex items-start gap-3 rounded-[14px] border px-3.5 py-3 text-left transition-colors disabled:cursor-not-allowed ${
                    on
                      ? "border-blue bg-blue/[0.05]"
                      : p.available
                        ? "border-[#EDEDF0] bg-white hover:border-[#D0D5DD]"
                        : "border-[#EDEDF0] bg-[#FAFAFA]"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[5px] border ${on ? "border-blue bg-blue text-white" : "border-[#667085] bg-white"}`}
                  >
                    {on && (
                      <Icon icon={huge(Tick02Icon)} size={14} stroke={2.2} />
                    )}
                  </span>
                  <span className={p.available ? "" : "opacity-50 grayscale"}>
                    <LogoPair models={p.models} size={30} />
                  </span>
                  <span
                    className={`min-w-0 ${p.available ? "" : "opacity-60"}`}
                  >
                    <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-[#101D37]">
                      {p.name}
                      {p.recommended && (
                        <span className="rounded-md bg-blue/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue">
                          Recommended
                        </span>
                      )}
                      {p.available ? (
                        <span className="flex items-center gap-1 rounded-md bg-[#2BCB23]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#1F9C19]">
                          <span className="size-1.5 rounded-full bg-[#2BCB23]" />
                          Available
                        </span>
                      ) : (
                        <span className="rounded-md bg-[#F2F4F7] px-1.5 py-0.5 text-[10px] font-semibold text-body">
                          Not available yet
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-body">{p.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-end border-t border-[#EDEDF0] px-4 py-2.5">
            <button
              type="button"
              onClick={close}
              className="h-8 rounded-[10px] bg-blue px-3 text-xs font-semibold text-white"
            >
              Done
            </button>
          </div>
        </>
      )}
    </Dropdown>
  );
}

/** Reasoning effort, shown next to the model button (like Claude's "Medium"). */
export function ReasoningPicker({ up }: { up?: boolean }) {
  const k = useKnowledge();
  const cur = REASONING.find((r) => r.id === k.reasoning) ?? REASONING[0];
  return (
    <Dropdown
      up={up}
      plain
      width={280}
      ariaLabel={`Reasoning: ${cur.name}`}
      label={cur.name}
    >
      {(close) => (
        <div
          role="radiogroup"
          aria-label="Reasoning"
          className="flex flex-col gap-0.5 p-1.5"
        >
          {REASONING.map((r) => {
            const on = r.id === cur.id;
            return (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  updateKnowledge(() => ({ reasoning: r.id }));
                  close();
                }}
                className={`flex items-start justify-between gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors ${
                  on ? "bg-blue/[0.06]" : "hover:bg-[#F8F9FC]"
                }`}
              >
                <span className="min-w-0">
                  <span
                    className={`block text-sm font-semibold ${on ? "text-blue" : "text-[#101D37]"}`}
                  >
                    {r.name}
                  </span>
                  <span className="block text-xs text-body">{r.desc}</span>
                </span>
                {on && (
                  <Icon
                    icon={huge(Tick02Icon)}
                    size={16}
                    stroke={2}
                    className="mt-0.5 shrink-0 text-blue"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </Dropdown>
  );
}

/** Sources + Models side by side (prompt toolbars) */
export default function ResearchPickers({ up }: { up?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SourcesPicker up={up} />
      <div className="flex items-center gap-0.5">
        <ModelsPicker up={up} />
        <ReasoningPicker up={up} />
      </div>
    </div>
  );
}
