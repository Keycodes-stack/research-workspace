import TopBar from "@/components/v2/dashboard/TopBar";
import ProjectsPanel from "@/components/v2/dashboard/ProjectsPanel";
import EvidenceLibrary from "@/components/v2/evidence/EvidenceLibrary";
import KnownProject from "@/components/v2/projects/KnownProject";
import { V2 } from "@/lib/v2/routes";

/** Evidence Library: the research evidence of every work package (AI-researched, judged, cited). */
export default async function EvidencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: slug } = await params;
  return (
    <KnownProject id={slug}>
    <div className="flex min-w-0 flex-1">
      <ProjectsPanel activeId={slug} newLabel="New Projects" showWorkPackages activeSection="evidence" />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar current="Evidence" trail={[{ label: "Projects", href: `${V2}/projects` }]} />
        <main className="flex flex-col gap-5 px-4 pt-10 pb-16 sm:px-6 lg:px-10">
          <h1 className="text-2xl leading-[1.2] font-semibold tracking-[-0.02em] text-[#101D37] sm:text-[30px]">
            <span className="text-blue">Evidence</span> Library
          </h1>
          <EvidenceLibrary id={slug} />
        </main>
      </div>
    </div>
    </KnownProject>
  );
}
