import WorkPackageWorkspace from "@/components/v2/projects/WorkPackageWorkspace";

export default async function WorkPackageWorkspacePage({ params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  return <WorkPackageWorkspace projectId={id} taskId={taskId} />;
}
