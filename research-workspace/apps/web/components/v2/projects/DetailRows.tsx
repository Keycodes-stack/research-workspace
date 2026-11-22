"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import Icon, { huge, type AnyIcon } from "@/components/v2/dashboard/Icon";

export type DetailItem = { title: string; detail?: string; href?: string };

/** Figma list rows: white, border #EDEDF0, radius 12, padding 10/16, gap 6, 43 high, rows 10 apart;
 *  text Inter 14 – regular #667085, or semibold #242C2C (`strong`, Departments & Workstreams).
 *  Rows with `detail` expand; rows with `href` link. */
export default function DetailRows({
  items,
  icon,
  strong,
}: {
  items: DetailItem[];
  icon: AnyIcon;
  strong?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const row = `flex min-h-[43px] w-full items-center gap-1.5 px-4 py-2.5 text-left text-sm leading-[1.5] tracking-[-0.02em] ${
    strong ? "font-semibold text-[#242C2C]" : "text-body hover:text-[#101D37]"
  }`;
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((it) => {
        const on = open === it.title;
        const inner = (
          <>
            <Icon icon={icon} size={16} stroke={1.3} className="shrink-0" />
            <span className="min-w-0 flex-1">{it.title}</span>
            <Icon
              icon={huge(ArrowUpRight01Icon)}
              size={14}
              stroke={1.4}
              className={`shrink-0 transition-transform ${on ? "rotate-90 text-blue" : ""}`}
            />
          </>
        );
        return (
          <li
            key={it.title}
            className="rounded-xl border border-[#EDEDF0] bg-white"
          >
            {it.href ? (
              <Link href={it.href} className={row}>
                {inner}
              </Link>
            ) : (
              <button
                type="button"
                aria-expanded={on}
                onClick={() => setOpen(on ? null : it.title)}
                className={row}
              >
                {inner}
              </button>
            )}
            {on && it.detail && (
              <p className="border-t border-[#EDEDF0] px-4 py-2.5 text-xs leading-[1.6] font-normal text-body">
                {it.detail}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  /* Figma: Inter 600 18, line height 120%, #101D37 */
  <h3 className="text-lg leading-[1.2] font-semibold tracking-[-0.02em] text-[#101D37]">
    {children}
  </h3>
);
