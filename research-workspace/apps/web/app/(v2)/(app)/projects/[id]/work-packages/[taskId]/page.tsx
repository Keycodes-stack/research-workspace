import WorkPackageOverview from "@/components/v2/projects/WorkPackageOverview";

export default async function WorkPackageOverviewPage({ params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  return <WorkPackageOverview projectId={id} taskId={taskId} />;
}
