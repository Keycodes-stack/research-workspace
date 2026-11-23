import ProjectShell from "@/components/v2/projects/ProjectShell";
import TeamTable from "@/components/v2/projects/TeamTable";
import KnownProject from "@/components/v2/projects/KnownProject";

/** Figma frame "Projects - Hydrogen Energy Feasibility - Project Teams". */
export default async function TeamsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: slug } = await params;
  return (
    <KnownProject id={slug}>
    <ProjectShell
      slug={slug}
      page="teams"
      crumb="Project Teams"
      title={
        <>
          Project <span className="text-blue">Teams</span>
        </>
      }
    >
      <TeamTable storageKey={`teams:${slug}:members`} />
    </ProjectShell>
    </KnownProject>
  );
}
