"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronLeftDouble,
  ChevronRight,
  Folder,
  HomeLine,
  LogOut01,
  Settings02,
  Signal01,
} from "@untitledui/icons";
import {
  Calendar03Icon,
  Mortarboard02Icon,
  Notification01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import Icon, { huge, untitled, type AnyIcon } from "./Icon";
import { setToken } from "@/lib/api";
import { V2 } from "@/lib/v2/routes";

type Item = { label: string; href: string; icon: AnyIcon; chevron?: boolean };

const MAIN_MENU: Item[] = [
  { label: "Home", href: `${V2}/home`, icon: untitled(HomeLine) },
  { label: "Projects", href: `${V2}/projects`, icon: untitled(Folder), chevron: true },
  { label: "Signals & Monitoring", href: "#", icon: untitled(Signal01) },
  { label: "Knowledge Library", href: `${V2}/knowledge`, icon: huge(Mortarboard02Icon) },
  { label: "Calendar", href: `${V2}/calendar`, icon: huge(Calendar03Icon) },
];

const OTHER_MENU: Item[] = [
  { label: "Notifications", href: "#", icon: huge(Notification01Icon) },
  { label: "Organization & Access", href: "/organization", icon: huge(UserGroupIcon) },
  { label: "Settings", href: "#", icon: untitled(Settings02) },
];

/* Figma "MAIN MENU" label: Inter 10 / 150%, 500, uppercase, +10%, #CECECE */
function SectionLabel({ children }: { children: string }) {
  return (
    <p className="text-[10px] leading-[1.5] font-medium tracking-[0.1em] text-[#CECECE] uppercase">
      {children}
    </p>
  );
}

/* Figma menu item: 228 x 40, radius 10, padding 8/12, icon 20 + gap 8 */
function NavItem({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: Item;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      className={`flex h-10 w-full items-center justify-between gap-5 rounded-[10px] px-3 py-2 transition-colors ${
        active
          ? "bg-blue text-white"
          : "text-[#EDEDF0] hover:bg-white/[0.06]"
      } ${collapsed ? "justify-center px-0" : ""}`}
    >
      <span className="flex items-center gap-2">
        <Icon icon={item.icon} size={20} className="shrink-0" />
        {!collapsed && (
          <span
            className={`text-base leading-[1.5] tracking-[-0.02em] whitespace-nowrap ${
              active ? "font-medium" : "font-normal"
            }`}
          >
            {item.label}
          </span>
        )}
      </span>
      {item.chevron && !collapsed && (
        <Icon icon={untitled(ChevronRight)} size={20} className="shrink-0" />
      )}
    </Link>
  );
}

export default function Sidebar({
  collapsed = false,
  onToggleCollapse,
  onNavigate,
}: {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href !== "#" && (pathname === href || pathname.startsWith(href + "/"));

  return (
    <aside
      className={`flex h-full flex-col border-r border-[#EDEDF0] bg-[#101D37] transition-[width] duration-200 ${
        collapsed ? "w-[76px]" : "w-[260px]"
      }`}
    >
      {/* Logo row – 64px, padding 16, bottom border #EDEDF0 @ 20% */}
      <div className="flex h-16 shrink-0 items-center border-b border-[#EDEDF0]/20 p-4">
        <div
          className={`flex h-8 w-full items-center ${
            collapsed ? "justify-center" : "justify-between"
          }`}
        >
          {!collapsed && (
            <Link
              href={`${V2}/home`}
              aria-label="Artifex Labs"
              className="relative block h-8 w-[136.67px]"
            >
              <Image
                src="/images/logo-artifex-labs-white.png"
                alt="Artifex Labs"
                width={1254}
                height={229}
                priority
                className="absolute top-[4.11px] left-[4.97px] h-auto w-[131.7px] max-w-none"
              />
            </Link>
          )}
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex size-5 items-center justify-center rounded text-white hover:opacity-75"
          >
            <Icon
              icon={untitled(ChevronLeftDouble)}
              size={20}
              className={collapsed ? "rotate-180" : ""}
            />
          </button>
        </div>
      </div>

      {/* Main menu – padding 16, label + items with 12px gap */}
      <nav className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {!collapsed && <SectionLabel>Main Menu</SectionLabel>}
        {MAIN_MENU.map((item) => (
          <NavItem
            key={item.label}
            item={item}
            active={isActive(item.href)}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      {/* Other menu – dashed (6, 6) top divider */}
      <div
        className="flex shrink-0 flex-col gap-3 p-4"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(237,237,240,0.2) 50%, transparent 50%)",
          backgroundSize: "12px 1px",
          backgroundRepeat: "repeat-x",
          backgroundPosition: "top",
        }}
      >
        {!collapsed && <SectionLabel>Other Menu</SectionLabel>}
        {OTHER_MENU.map((item) => (
          <NavItem
            key={item.label}
            item={item}
            active={false}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ))}
      </div>

      {/* Account */}
      <div className="flex shrink-0 flex-col gap-3 border-t border-[#EDEDF0]/20 p-4">
        {!collapsed && <SectionLabel>Account</SectionLabel>}
        <div
          className={`flex items-center ${
            collapsed ? "justify-center" : "justify-between pl-2"
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Image
              src="/images/avatar-ibrahim.png"
              alt="Ibrahim Ghatila"
              width={40}
              height={40}
              className="size-10 shrink-0 rounded-full"
            />
            {!collapsed && (
              <div className="flex flex-col">
                <span className="text-base leading-[1.5] tracking-[-0.02em] text-[#EDEDF0]">
                  Ibrahim Ghatila
                </span>
                <span className="-mt-1 text-xs leading-[1.5] tracking-[-0.02em] text-[#EDEDF0]">
                  Admin
                </span>
              </div>
            )}
          </div>
          {!collapsed && (
            <button
              type="button"
              onClick={() => { setToken(null); window.location.assign("/"); }}
              aria-label="Log out"
              className="pr-2 text-white hover:opacity-75"
            >
              <Icon icon={untitled(LogOut01)} size={20} />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
