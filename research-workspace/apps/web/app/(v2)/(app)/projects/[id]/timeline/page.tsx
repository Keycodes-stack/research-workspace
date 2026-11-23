import TopBar from "@/components/v2/dashboard/TopBar";
import ProjectsPanel from "@/components/v2/dashboard/ProjectsPanel";
import PlanTimeline from "@/components/v2/timeline/PlanTimeline";
import KnownProject from "@/components/v2/projects/KnownProject";
import { V2 } from "@/lib/v2/routes";

/** Figma frame "Integrated Plan & Timeline" – title at (515, 104), card at (515, 160). */
export default async function TimelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: slug } = await params;
  return (
    <KnownProject id={slug}>
    <div className="flex min-w-0 flex-1">
      <ProjectsPanel activeId={slug} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          current="Integrated Plan & Timeline"
          trail={[{ label: "Projects", href: `${V2}/projects` }]}
        />
        <main className="flex flex-col gap-5 px-4 pt-10 pb-16 sm:px-6 lg:px-10">
          <h1 className="text-2xl leading-[1.2] font-semibold tracking-[-0.02em] text-[#101D37] sm:text-[30px]">
            Integrated Plan &amp; <span className="text-blue">Timeline</span>
          </h1>
          <PlanTimeline />
        </main>
      </div>
    </div>
    </KnownProject>
  );
}
