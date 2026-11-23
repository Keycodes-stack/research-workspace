"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import TopBar from "@/components/v2/dashboard/TopBar";
import ProjectsPanel from "@/components/v2/dashboard/ProjectsPanel";
import AskComposer from "@/components/v2/ask/AskComposer";
import AnswerCard from "@/components/v2/ask/AnswerCard";
import { useProjects } from "@/components/v2/V2Frame";
import { api } from "@/lib/api";
import type { AskResult, EvidenceScope, Message } from "@/lib/types";
import { plainContent } from "@/lib/v2/answer";
import { pending, prefs, runAsk } from "@/lib/v2/ask";
import { V2 } from "@/lib/v2/routes";

/*
 * One chat of a project (no design screen: styled after the design's Project Chats). History comes from the server,
 * so a chat looks the same in every browser. A question from Home arrives through `pending` and is asked on open.
 */
type Turn =
  | { kind: "question"; id: string; text: string }
  | { kind: "answer"; id: string; result: AskResult }
  | { kind: "note"; id: string; text: string }          // an older answer saved without its details
  | { kind: "error"; id: string; text: string };

const toTurns = (messages: Message[]): Turn[] =>
  messages.map((m) =>
    m.role === "user" ? { kind: "question", id: m.id, text: m.content }
      : m.final ? { kind: "answer", id: m.id, result: m.final }
        : { kind: "note", id: m.id, text: plainContent(m.content) });

function Bubble({ children, mine }: { children: React.ReactNode; mine?: boolean }) {
  return (
    <div className={`max-w-[85%] rounded-xl border border-[#EDEDF0] px-2.5 py-2 text-sm leading-[1.5] tracking-[-0.02em] break-words text-[#101D37] sm:max-w-[70%] ${
      mine ? "self-end bg-[#FAFAFA]" : "self-start bg-white"}`}>
      {children}
    </div>
  );
}

export default function ChatPage() {
  const { id: projectId, chatId } = useParams<{ id: string; chatId: string }>();
  const { projects } = useProjects();
  const project = projects.find((p) => p.id === projectId);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [steps, setSteps] = useState<string[] | null>(null);       // live steps while a question is answered
  const [scope, setScope] = useState<EvidenceScope>("both");
  const listRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const ask = async (question: string, s: EvidenceScope) => {
    const key = `${Date.now()}`;
    setTurns((t) => [...t, { kind: "question", id: `q${key}`, text: question }]);
    setSteps([]);
    try {
      const result = await runAsk(chatId, question, s, setSteps);
      setTurns((t) => [...t, { kind: "answer", id: result.message_id ?? `a${key}`, result }]);
    } catch (e) {
      setTurns((t) => [...t, { kind: "error", id: `e${key}`, text: e instanceof Error ? e.message : "The question could not be answered." }]);
    } finally {
      setSteps(null);
    }
  };

  useEffect(() => {
    // Strict mode runs effects twice in development: load and ask once per chat.
    if (started.current) return;
    started.current = true;
    const first = pending.take(chatId);
    setScope(first?.scope ?? prefs.scope());
    prefs.setProject(projectId);
    api.messages(chatId)
      .then((m) => setTurns(toTurns(m)))
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load this chat."))
      .finally(() => {
        setLoading(false);
        if (first) void ask(first.question, first.scope);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, projectId]);

  useEffect(() => {
    const el = listRef.current;
    el?.scrollTo?.({ top: el.scrollHeight, behavior: "smooth" });   // keep the newest message in view
  }, [turns.length, steps?.length]);

  const title = turns.find((t) => t.kind === "question")?.text ?? "New chat";

  return (
    <div className="flex min-w-0 flex-1">
      <ProjectsPanel activeId={projectId} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar current="Chat" trail={[{ label: project?.name ?? "Project", href: `${V2}/projects/${projectId}` }]} />

        <main className="flex min-h-0 flex-1 flex-col gap-5 px-4 pt-10 pb-10 sm:px-6 lg:px-10">
          <h1 className="truncate text-xl leading-[1.2] font-semibold tracking-[-0.02em] text-[#101D37] sm:text-2xl" title={title}>
            {title}
          </h1>

          <section className="flex min-h-[420px] w-full flex-1 flex-col gap-5 rounded-2xl border border-[#EDEDF0] bg-white p-4">
            <div ref={listRef} aria-live="polite" className="chat-scroll flex max-h-[calc(100dvh-420px)] min-h-[200px] flex-1 flex-col gap-4 overflow-y-auto pr-2.5">
              {loading && <p className="text-sm text-body">Loading the chat…</p>}
              {loadError && <p role="alert" className="text-sm text-[#B42318]">Could not load this chat: {loadError}</p>}
              {!loading && !loadError && turns.length === 0 && steps == null && (
                <p className="text-sm text-body">Ask a question about this project below.</p>
              )}
              {turns.map((t) =>
                t.kind === "question" ? <Bubble key={t.id} mine>{t.text}</Bubble>
                  : t.kind === "answer" ? <AnswerCard key={t.id} result={t.result} />
                    : t.kind === "note" ? <Bubble key={t.id}>{t.text}</Bubble>
                      : <p key={t.id} role="alert" className="self-start rounded-xl border border-[#FDA29B] bg-[#FEF3F2] px-2.5 py-2 text-sm text-[#B42318]">{t.text}</p>)}
              {steps != null && (
                <div className="self-start rounded-xl border border-[#EDEDF0] bg-[#FAFAFA] px-2.5 py-2" role="status">
                  <p className="text-xs font-medium text-[#101D37]">Working on it…</p>
                  <ol className="mt-1 flex flex-col gap-0.5 text-xs leading-[1.5] text-body">
                    {(steps.length ? steps : ["Starting…"]).map((s, i) => <li key={i}>{s}</li>)}
                  </ol>
                </div>
              )}
            </div>

            <AskComposer
              projectId={projectId}
              scope={scope}
              onScopeChange={(s) => { setScope(s); prefs.setScope(s); }}
              busy={steps != null || loading}
              onAsk={(q) => void ask(q, scope)}
              placeholder="Ask a follow-up question.."
            />
          </section>
        </main>
      </div>
    </div>
  );
}
