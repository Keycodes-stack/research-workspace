"use client";

import Link from "next/link";
import { Fragment } from "react";
import { ChevronRight, Menu01 } from "@untitledui/icons";
import { Notification01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import Icon, { huge, untitled } from "./Icon";
import { useShell } from "./DashboardShell";

/**
 * Figma "Top Bar": height 64, padding 16/40, white, bottom border #EDEDF0.
 * Breadcrumb Inter 16/24 (-2%): "Main Menu" #667085 › current #285CE0 (500).
 * Search 272 x 40, radius 10, padding 10/12, gap 8.
 * Bell button 40 x 40, radius 10, border #EDEDF0; bell #101D37 + 8px #285CE0 dot.
 */
export default function TopBar({
  current,
  trail = [],
}: {
  current: string;
  /** intermediate crumbs between "Main Menu" and the current page */
  trail?: { label: string; href: string }[];
}) {
  const { openMenu } = useShell();

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-[#EDEDF0] bg-white px-4 sm:px-6 lg:px-10">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={openMenu}
          aria-label="Open menu"
          className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-[#EDEDF0] text-[#101D37] lg:hidden"
        >
          <Icon icon={untitled(Menu01)} size={20} />
        </button>
        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 items-center gap-1 text-base leading-[1.5] tracking-[-0.02em]"
        >
          <span className="hidden text-body sm:inline">Main Menu</span>
          <Icon
            icon={untitled(ChevronRight)}
            size={16}
            className="hidden shrink-0 text-body sm:block"
          />
          {trail.map((c) => (
            <Fragment key={c.href}>
              <Link href={c.href} className="hidden text-body hover:text-[#101D37] sm:inline">
                {c.label}
              </Link>
              <Icon
                icon={untitled(ChevronRight)}
                size={16}
                className="hidden shrink-0 text-body sm:block"
              />
            </Fragment>
          ))}
          <span className="truncate font-medium text-blue">{current}</span>
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <label className="hidden h-10 w-[272px] items-center gap-2 rounded-[10px] border border-[#EDEDF0] bg-white px-3 py-2.5 md:flex">
          <Icon icon={huge(Search01Icon)} size={16} className="shrink-0 text-body" />
          <input
            type="search"
            placeholder="Search workspace"
            className="w-full min-w-0 bg-transparent text-sm leading-[1.5] tracking-[-0.02em] text-[#101D37] outline-none placeholder:text-body"
          />
        </label>
        <button
          type="button"
          aria-label="Notifications"
          className="relative flex size-10 items-center justify-center rounded-[10px] border border-[#EDEDF0] bg-white p-2.5 text-[#101D37]"
        >
          <Icon icon={huge(Notification01Icon)} size={20} />
          <span className="absolute top-[9px] left-[22.2px] size-2 rounded-full bg-blue" />
        </button>
      </div>
    </header>
  );
}
