import ProjectShell from "@/components/v2/projects/ProjectShell";
import ProjectChat from "@/components/v2/projects/ProjectChat";
import KnownProject from "@/components/v2/projects/KnownProject";

/** Figma frame "Projects - Hydrogen Energy Feasibility - Project Chats". */
export default async function ChatsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: slug } = await params;
  return (
    <KnownProject id={slug}>
    <ProjectShell slug={slug} page="chats" crumb="Chats" title="Project Chats" showWorkPackages newLabel="New Projects">
      <ProjectChat storageKey={`chats:${slug}:messages`} />
    </ProjectShell>
    </KnownProject>
  );
}
