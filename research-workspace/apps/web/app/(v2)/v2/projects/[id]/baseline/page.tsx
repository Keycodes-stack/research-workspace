import { SearchList01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { huge } from "@/components/v2/dashboard/Icon";
import ProjectShell from "@/components/v2/projects/ProjectShell";
import DetailRows, { SectionTitle } from "@/components/v2/projects/DetailRows";
import ReviewChecker from "@/components/v2/projects/ReviewChecker";
import { PROJECTS } from "@/lib/v2/design/projects";
import { BASELINE_SUMMARY } from "@/lib/v2/design/projectScreens";
import KnownProject from "@/components/v2/projects/KnownProject";

/** Figma frame "Project Baseline & Approvals". */
export default async function BaselinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: slug } = await params;
  /* Decision Record: the approved baselines of the projects (Figma lists the sample projects).
   * Sample names only: they are not projects of this workspace, so they don't link (placeholder.md). */
  const decisions = PROJECTS.slice(0, 3).map((p) => ({ title: p.name }));

  return (
    <KnownProject id={slug}>
    <ProjectShell
      slug={slug}
      page="baseline"
      crumb="Project Baseline & Approvals"
      title={
        <>
          Project <span className="text-blue">Baseline &amp; Approvals</span>
        </>
      }
    >
      <section className="flex w-full flex-col gap-6 rounded-[20px] border border-[#EDEDF0] bg-[#FAFAFA] p-5">
        <div className="grid gap-[19px] md:grid-cols-2">
          <div className="flex flex-col gap-2.5">
            <SectionTitle>Baseline Summary</SectionTitle>
            <DetailRows items={BASELINE_SUMMARY} icon={huge(SearchList01Icon)} />
          </div>
          <div className="flex flex-col gap-2.5">
            <SectionTitle>Decision Record</SectionTitle>
            <DetailRows items={decisions} icon={huge(Tick02Icon)} />
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <SectionTitle>Review Checker</SectionTitle>
          <ReviewChecker storageKey={`baseline:${slug}:decisions`} />
        </div>
      </section>
    </ProjectShell>
    </KnownProject>
  );
}
