"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import Sidebar from "./Sidebar";

const ShellContext = createContext<{ openMenu: () => void }>({
  openMenu: () => {},
});

export const useShell = () => useContext(ShellContext);

/**
 * Figma frames are 1440 x 1080: Sidebar (260) + page.
 * ≥1024px: sidebar is fixed on the left (collapsible).
 * <1024px: sidebar becomes an off-canvas drawer opened from the top bar.
 */
export default function DashboardShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <ShellContext.Provider value={{ openMenu: () => setMobileOpen(true) }}>
      <div className="flex min-h-dvh bg-[#F8F9FC]">
        {/* Desktop sidebar */}
        <div className="sticky top-0 hidden h-dvh shrink-0 lg:block">
          <Sidebar
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed((c) => !c)}
          />
        </div>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              aria-label="Close menu"
              className="absolute inset-0 bg-[#101D37]/40"
              onClick={() => setMobileOpen(false)}
            />
            <div className="relative h-full w-[260px]">
              <Sidebar
                onToggleCollapse={() => setMobileOpen(false)}
                onNavigate={() => setMobileOpen(false)}
              />
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1">{children}</div>
      </div>
    </ShellContext.Provider>
  );
}
