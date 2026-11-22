"use client";

import { useEffect, useState } from "react";
import {
  CheckmarkCircle02Icon,
  Edit02Icon,
  Message01Icon,
} from "@hugeicons/core-free-icons";
import Icon, { huge } from "@/components/v2/dashboard/Icon";
import { REVIEW_ITEMS } from "@/lib/v2/design/projectScreens";

type Decision = {
  verdict: "Approved" | "Changes requested";
  note: string;
  at: string;
};

/** Figma "Review Checker": list of review items; the open one shows "Reviewer Decision"
 *  with a note box and Approve / Request Changes. Decisions are kept in this browser. */
export default function ReviewChecker({ storageKey }: { storageKey: string }) {
  const [open, setOpen] = useState<string | null>(REVIEW_ITEMS[0].id);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setDecisions(JSON.parse(raw));
    } catch {
      /* ignore damaged data */
    }
  }, [storageKey]);

  const decide = (id: string, verdict: Decision["verdict"]) => {
    const note = (notes[id] ?? "").trim();
    if (verdict === "Changes requested" && !note)
      return setError("Write what needs to change before requesting changes.");
    setError(null);
    const next = {
      ...decisions,
      [id]: { verdict, note, at: new Date().toISOString() },
    };
    setDecisions(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* storage full */
    }
    const following = REVIEW_ITEMS.find((r) => r.id !== id && !next[r.id]);
    setOpen(following?.id ?? null);
  };

  const undo = (id: string) => {
    const next = { ...decisions };
    delete next[id];
    setDecisions(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* storage full */
    }
    setOpen(id);
  };

  return (
    <ul className="flex flex-col gap-2.5">
      {REVIEW_ITEMS.map((r) => {
        const on = open === r.id;
        const dec = decisions[r.id];
        return (
          <li
            key={r.id}
            className="rounded-2xl border border-[#EDEDF0] bg-white"
          >
            <button
              type="button"
              aria-expanded={on}
              onClick={() => {
                setError(null);
                setOpen(on ? null : r.id);
              }}
              className={`flex min-h-[43px] w-full items-center gap-1.5 px-4 py-2.5 text-left text-sm leading-[1.5] tracking-[-0.02em] ${
                on ? "text-[#101D37]" : "text-body hover:text-[#101D37]"
              }`}
            >
              <Icon
                icon={huge(Message01Icon)}
                size={16}
                stroke={1.3}
                className="shrink-0"
              />
              <span className="min-w-0 flex-1">{r.title}</span>
              {dec && (
                <span
                  className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                    dec.verdict === "Approved"
                      ? "bg-[#2BCB23]/10 text-[#2BCB23]"
                      : "bg-[#FF2020]/10 text-[#FF6720]"
                  }`}
                >
                  {dec.verdict}
                </span>
              )}
            </button>

            {on && (
              <div className="px-4 pb-4">
                {dec ? (
                  <div className="flex flex-col gap-2 rounded-xl border border-[#EDEDF0] bg-[#FAFAFA] p-4 text-sm leading-[1.6] text-body">
                    <span className="font-semibold text-[#101D37]">
                      {dec.verdict} ·{" "}
                      {new Date(dec.at).toLocaleString([], {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {dec.note && <span>{dec.note}</span>}
                    <button
                      type="button"
                      onClick={() => undo(r.id)}
                      className="self-start font-semibold text-blue hover:underline"
                    >
                      Change decision
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4 rounded-xl border border-[#EDEDF0] bg-[#FAFAFA] p-4">
                    <label className="flex flex-col gap-2.5">
                      <span className="text-sm leading-[1.5] font-medium tracking-[-0.02em] text-[#101D37]">
                        Reviewer Decision
                      </span>
                      <textarea
                        value={notes[r.id] ?? ""}
                        onChange={(e) =>
                          setNotes((n) => ({ ...n, [r.id]: e.target.value }))
                        }
                        rows={3}
                        placeholder="Write here.."
                        className="h-[88px] resize-none rounded-xl border border-[#EDEDF0] bg-white px-3 py-2.5 text-sm leading-[1.5] text-[#101D37] outline-none placeholder:text-body focus:border-blue"
                      />
                    </label>
                    {error && (
                      <p role="alert" className="text-xs text-[#FF2020]">
                        {error}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => decide(r.id, "Approved")}
                        className="flex h-8 items-center gap-1.5 rounded-lg bg-blue px-3 text-[13px] font-semibold text-white"
                      >
                        <Icon
                          icon={huge(CheckmarkCircle02Icon)}
                          size={14}
                          stroke={1.5}
                        />
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => decide(r.id, "Changes requested")}
                        className="flex h-8 items-center gap-1.5 rounded-lg border border-[#EDEDF0] bg-white px-3 text-[13px] font-semibold text-[#242C2C]"
                      >
                        <Icon icon={huge(Edit02Icon)} size={14} stroke={1.5} />
                        Request Changes
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
