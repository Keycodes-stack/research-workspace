"use client";

import type { ReactNode } from "react";
import NotFoundCard from "@/components/v2/dashboard/NotFoundCard";
import { useProjects } from "@/components/v2/V2Frame";

/** The design's notFound() for unknown project slugs: projects load in the browser, so the check happens here. */
export default function KnownProject({ id, children }: { id: string; children: ReactNode }) {
  const { projects, loading, error } = useProjects();
  if (!loading && !error && !projects.some((p) => p.id === id)) {
    return (
      <div className="flex min-h-dvh min-w-0 flex-1">
        <NotFoundCard />
      </div>
    );
  }
  return <>{children}</>;
}
