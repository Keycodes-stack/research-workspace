"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, consumeTokenFragment, getToken } from "@/lib/api";
import type { Project } from "@/lib/types";
import { useLoad } from "@/components/useLoad";
import DashboardShell from "./dashboard/DashboardShell";

/** The signed-in user's projects, loaded once and shared by every screen of the new UI. */
type ProjectsState = { projects: Project[]; loading: boolean; error: string | null; reload: () => Promise<void> };
const ProjectsContext = createContext<ProjectsState>({ projects: [], loading: true, error: null, reload: async () => {} });
export const useProjects = () => useContext(ProjectsContext);

function ProjectsProvider({ children }: { children: ReactNode }) {
  const { data, loading, error, reload } = useLoad(() => api.projects());
  return (
    <ProjectsContext.Provider value={{ projects: data ?? [], loading, error, reload }}>{children}</ProjectsContext.Provider>
  );
}

/** Sign-in check (same token as the current UI), then the design's shell around every screen. */
export default function V2Frame({ children }: { children: ReactNode }) {
  const [token, setTok] = useState<string | null | undefined>(undefined);
  useEffect(() => { consumeTokenFragment(); setTok(getToken()); }, []);

  if (token === undefined) return null;
  if (!token) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <div className="flex max-w-md flex-col gap-3 rounded-[20px] border border-[#EDEDF0] bg-white p-8 text-center">
          <h1 className="text-xl font-semibold text-[#101D37]">Sign in</h1>
          <p className="text-sm text-body">You are not signed in. Sign in, then open this page again.</p>
          <a href="/" className="mx-auto rounded-[10px] bg-blue px-4 py-2 text-sm font-semibold text-white">Go to sign in</a>
        </div>
      </main>
    );
  }
  return (
    <ProjectsProvider>
      <DashboardShell>{children}</DashboardShell>
    </ProjectsProvider>
  );
}
