import TopBar from "@/components/v2/dashboard/TopBar";
import KnowledgeLibrary from "@/components/v2/knowledge/KnowledgeLibrary";

/** Knowledge Library: repositories, uploads and connectors that research draws on. */
export default function KnowledgePage() {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <TopBar current="Knowledge Library" />
      <main className="flex flex-col px-4 pt-10 pb-16 sm:px-6 lg:px-10">
        <KnowledgeLibrary />
      </main>
    </div>
  );
}
