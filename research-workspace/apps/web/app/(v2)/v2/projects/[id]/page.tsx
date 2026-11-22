import ProjectOverview from "@/components/v2/projects/ProjectOverview";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectOverview id={id} />;
}
