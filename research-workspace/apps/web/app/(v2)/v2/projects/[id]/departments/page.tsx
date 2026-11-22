import { SearchList01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import AvatarStack from "@/components/v2/dashboard/AvatarStack";
import { huge } from "@/components/v2/dashboard/Icon";
import ProjectShell from "@/components/v2/projects/ProjectShell";
import DetailRows, { SectionTitle } from "@/components/v2/projects/DetailRows";
import { HANDOFFS, INITIATIVES, STATE_STYLE, WORKSTREAM_MATRIX } from "@/lib/v2/design/projectScreens";
import KnownProject from "@/components/v2/projects/KnownProject";

/* Figma rows (845 wide, padding 16): Record/Team text at 67, Details at 406.6, State pill (101 x 32) at 727.6 */
const GRID = "grid grid-cols-[minmax(0,390.6fr)_minmax(0,321fr)_101px] items-center";

/** Figma frame "Departments & Workstreams". */
export default async function DepartmentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: slug } = await params;
  return (
    <KnownProject id={slug}>
    <ProjectShell
      slug={slug}
      page="departments"
      crumb="Departments & Workstreams"
      title={
        <>
          Departments &amp; <span className="text-blue">Workstreams</span>
        </>
      }
    >
      <section className="flex w-full flex-col gap-6 rounded-[20px] border border-[#EDEDF0] bg-[#FAFAFA] p-5">
        <div className="grid gap-[19px] md:grid-cols-2">
          <div className="flex flex-col gap-2.5">
            <SectionTitle>Workstream Matrix</SectionTitle>
            <DetailRows items={WORKSTREAM_MATRIX} icon={huge(SearchList01Icon)} strong />
          </div>
          <div className="flex flex-col gap-2.5">
            <SectionTitle>Handoffs</SectionTitle>
            <DetailRows items={HANDOFFS} icon={huge(Tick02Icon)} strong />
          </div>
        </div>

        <div className="h-px w-full bg-[#EDEDF0]" />

        <div className="flex flex-col gap-2.5">
          <SectionTitle>Projects Research Initiatives</SectionTitle>
          <div className="-mx-5 overflow-x-auto px-5">
            <div className="flex min-w-[640px] flex-col gap-[9px]">
              <div className={`${GRID} px-4 text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[#101D37]`}>
                <span>Record / Team</span>
                <span>Details</span>
                <span>State</span>
              </div>
              {INITIATIVES.map((r, i) => (
                <div key={i} className={`${GRID} h-[50px] rounded-2xl border border-[#EDEDF0] bg-white px-4`}>
                  <div className="flex min-w-0 items-center gap-2">
                    <AvatarStack size={20} />
                    <span className="truncate text-xs leading-[1.5] font-semibold tracking-[-0.02em] text-[#242C2C]">{r.record}</span>
                  </div>
                  <span className="truncate pr-3 text-xs leading-[1.5] tracking-[-0.02em] text-body">{r.details}</span>
                  <span
                    className={`flex h-8 items-center justify-center rounded-[10px] px-3 text-xs leading-[1.5] font-medium whitespace-nowrap ${STATE_STYLE[r.state]}`}
                  >
                    {r.state}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </ProjectShell>
    </KnownProject>
  );
}
