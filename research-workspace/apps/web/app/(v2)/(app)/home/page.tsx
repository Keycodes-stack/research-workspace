"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import TopBar from "@/components/v2/dashboard/TopBar";
import AskComposer from "@/components/v2/ask/AskComposer";
import AnswerCard from "@/components/v2/ask/AnswerCard";
import AnswerError from "@/components/v2/ask/AnswerError";
import { useProjects } from "@/components/v2/V2Frame";
import { api } from "@/lib/api";
import type { AskResult, ChatRow, EvidenceScope, SourceRow } from "@/lib/types";
import { prefs, runAsk } from "@/lib/v2/ask";
import { V2 } from "@/lib/v2/routes";

/*
 * Home asks inline: the question, the live steps, then the full answer (findings with citations, Model A and Model B
 * side by side, the judge's statement and the sources). Follow-up questions continue the same chat; "Open chat" goes
 * to its page. The lists on the right show this project's real chats, projects and sources.
 */
type Turn = { id: number; question: string; result?: AskResult; error?: string };

export default function HomePage() {
  const router = useRouter();
  const { projects, loading, error: loadError } = useProjects();
  // Closed-repository projects ask through approved research tasks, so only open-discovery projects take questions.
  const options = useMemo(
    () => projects.filter((p) => p.mode === "open_discovery").map((p) => ({ value: p.id, label: p.name })),
    [projects],
  );
  const hasClosed = projects.some((p) => p.mode !== "open_discovery");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [scope, setScope] = useState<EvidenceScope>("both");
  const [chatId, setChatId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [steps, setSteps] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [sideError, setSideError] = useState<string | null>(null);
  const nextId = useRef(0);
  const conversation = useRef<HTMLDivElement>(null);

  // the chat box grows as turns arrive and keeps the newest message in view
  useEffect(() => {
    const el = conversation.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, steps]);

  useEffect(() => setScope(prefs.scope()), []);
  useEffect(() => {
    // the last project used in this browser, if it still exists and takes questions; else the first that does
    if (projectId && options.some((o) => o.value === projectId)) return;
    const saved = prefs.project();
    setProjectId(options.find((o) => o.value === saved)?.value ?? options[0]?.value ?? null);
  }, [options, projectId]);

  const loadSide = (pid: string) =>
    Promise.all([api.chats(pid), api.sources(pid)])
      .then(([c, s]) => { setChats(c); setSources(s); setSideError(null); })
      .catch((e) => setSideError(e instanceof Error ? e.message : "Could not load this project."));

  useEffect(() => {
    if (!projectId) return;
    setChats([]);
    setSources([]);
    void loadSide(projectId);
    // loadSide only reads projectId, so it is re-run only when the project changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const changeProject = (id: string) => {
    setProjectId(id);
    prefs.setProject(id);
    setChatId(null);
    setTurns([]);
    setError(null);
  };

  const ask = async (question: string) => {
    if (!projectId) return;
    const id = ++nextId.current;
    setBusy(true);
    setError(null);
    setSteps([]);
    setTurns((t) => [...t, { id, question }]);
    try {
      let cid = chatId;
      if (!cid) {
        // A chat is created with the first question, so follow-ups continue it.
        const chat = await api.createChat(projectId, question.slice(0, 120));
        cid = chat.id;
        setChatId(cid);
      }
      const result = await runAsk(cid, question, scope, setSteps);
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, result } : x)));
      void loadSide(projectId);
    } catch (e) {
      const message = e instanceof Error ? e.message : "The question could not be answered.";
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, error: message } : x)));
    } finally {
      setSteps(null);
      setBusy(false);
    }
  };

  const newQuestion = () => {
    setChatId(null);
    setTurns([]);
    setError(null);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <TopBar current="Home" />

      <main className="px-4 pt-10 pb-16 sm:px-6 lg:px-10">
        <div className="mx-auto flex w-full max-w-[964px] flex-col gap-[30px]">
          <h1 className="text-center text-2xl leading-[1.2] font-semibold tracking-[-0.02em] text-[#101D37] sm:text-[30px]">
            What Would You <span className="text-blue">Like To Investigate?</span>
          </h1>

          <div className="flex flex-col gap-2">
            <AskComposer
              projectId={projectId}
              projects={options}
              onProjectChange={changeProject}
              onCreateProject={() => router.push(`${V2}/projects/new`)}
              scope={scope}
              onScopeChange={(s) => { setScope(s); prefs.setScope(s); }}
              busy={busy || loading}
              onAsk={(q) => void ask(q)}
            />
            {(error || loadError) && (
              <p role="alert" className="text-sm text-[#B42318]">{error ?? `Could not load projects: ${loadError}`}</p>
            )}
            {!loading && !loadError && options.length === 0 && (
              <p className="text-sm text-body">
                No project can take questions yet. Questions need an open-discovery project.
                {hasClosed && " Closed-repository projects are not listed here: they ask through approved research tasks."}
              </p>
            )}
          </div>

          {turns.length > 0 && (
            <section aria-label="This conversation" className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="text-body">{chatId ? "Follow-up questions continue this chat." : "Starting a new chat."}</span>
                <div className="flex items-center gap-4">
                  {/* shown only once the answer is saved: opening earlier shows an empty chat */}
                  {chatId && projectId && !busy && (
                    <Link href={`${V2}/projects/${projectId}/ask/${chatId}`} className="font-medium text-blue">Open chat</Link>
                  )}
                  <button type="button" onClick={newQuestion} className="font-medium text-[#101D37]">New question</button>
                </div>
              </div>
              <div ref={conversation} className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto rounded-[16px] border border-[#EDEDF0] bg-white p-4">
              {turns.map((t) => (
                <div key={t.id} className="flex flex-col gap-3">
                  <div className="max-w-[85%] self-end rounded-xl border border-[#EDEDF0] bg-[#FAFAFA] px-2.5 py-2 text-sm leading-[1.5] text-[#101D37] break-words sm:max-w-[70%]">
                    {t.question}
                  </div>
                  {t.result && <AnswerCard result={t.result} />}
                  {t.error && (
                    <AnswerError message={t.error} onRetry={() => void ask(t.question)} />
                  )}
                </div>
              ))}
              {steps != null && (
                <div className="self-start rounded-xl border border-[#EDEDF0] bg-[#FAFAFA] px-2.5 py-2" role="status">
                  <p className="text-xs font-medium text-[#101D37]">Working on it…</p>
                  <ol className="mt-1 flex flex-col gap-0.5 text-xs leading-[1.5] text-body">
                    {(steps.length ? steps : ["Starting…"]).map((s, i) => <li key={i}>{s}</li>)}
                  </ol>
                </div>
              )}
              </div>
            </section>
          )}

          <div className="grid grid-cols-1 gap-[30px] md:grid-cols-3">
            <section className="flex flex-col gap-4">
              <h2 className="text-base leading-[1.5] font-medium tracking-[-0.02em] text-[#101D37]">Recent chats</h2>
              {chats.length === 0 ? (
                <p className="text-sm text-body">No chats in this project yet.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {chats.slice(0, 5).map((c) => (
                    <li key={c.id}>
                      <Link href={`${V2}/projects/${projectId}/ask/${c.id}`} className="block truncate text-sm text-body hover:text-[#101D37]">
                        {c.title || "Untitled chat"}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="flex flex-col gap-4">
              <h2 className="text-base leading-[1.5] font-medium tracking-[-0.02em] text-[#101D37]">Your projects</h2>
              {projects.length === 0 ? (
                <p className="text-sm text-body">No projects yet.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {projects.slice(0, 5).map((p) => (
                    <li key={p.id}>
                      <Link href={`${V2}/projects/${p.id}`} className="block truncate text-sm text-body hover:text-[#101D37]">{p.name}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="flex flex-col gap-4">
              <h2 className="text-base leading-[1.5] font-medium tracking-[-0.02em] text-[#101D37]">Sources in this project</h2>
              {sources.length === 0 ? (
                <p className="text-sm text-body">No sources yet. Add PDFs with + above, or search online.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {sources.slice(0, 5).map((s) => (
                    <li key={s.id} className="truncate text-sm text-body">{s.title || s.filename || "Untitled source"}</li>
                  ))}
                </ul>
              )}
              {sideError && <p role="alert" className="text-xs text-[#B42318]">{sideError}</p>}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
