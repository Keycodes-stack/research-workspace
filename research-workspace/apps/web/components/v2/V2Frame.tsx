"use client";

import { createContext, useContext, type ReactNode } from "react";
import { api } from "@/lib/api";
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

/** Testing build: no sign-in check — every screen renders directly.
 * The server still guards the data (calls without a token get 401). */
export default function V2Frame({ children }: { children: ReactNode }) {
  return (
    <ProjectsProvider>
      <DashboardShell>{children}</DashboardShell>
    </ProjectsProvider>
  );
}
