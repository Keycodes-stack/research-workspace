"use client";

import "@syncfusion/ej2-tailwind3-theme/styles/document-editor-container/index.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { registerLicense } from "@syncfusion/ej2-base";
import {
  DocumentEditorContainerComponent,
  Ribbon,
  Toolbar,
  type CommentElementBox,
  type DocumentEditor,
} from "@syncfusion/ej2-react-documenteditor";
import { File02, MessageTextSquare02, PresentationChart01 } from "@untitledui/icons";
import { BinocularsIcon } from "@hugeicons/core-free-icons";
import Icon, { huge, untitled, type AnyIcon } from "@/components/v2/dashboard/Icon";
import CommentsPanel from "./CommentsPanel";
import FindingDetail from "./FindingDetail";
import { INITIAL_SFDT } from "@/lib/v2/workspaceSfdt";
import { CURRENT_USER, type Comment } from "@/lib/v2/workspaceDoc";
import { plainToSfdt, tiptapToSfdt } from "@/lib/v2/tiptapToSfdt";
import { api, ApiError } from "@/lib/api";
import type { EvidenceItem } from "@/lib/types";

DocumentEditorContainerComponent.Inject(Toolbar, Ribbon);

/* Free Syncfusion Community License key goes in .env.local as NEXT_PUBLIC_SYNCFUSION_LICENSE_KEY.
 * Without it the editor still works but shows Syncfusion's license notice. */
const LICENSE = process.env.NEXT_PUBLIC_SYNCFUSION_LICENSE_KEY;
if (LICENSE) registerLicense(LICENSE);

const AVATARS: Record<string, string> = {
  "Ibrahim Ghatila": "/images/avatar-ibrahim.png",
  "Omar Patel": "/images/avatar-omar.png",
};

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }).replace(":", ".");
  const today = new Date().toDateString() === d.toDateString();
  return `${today ? "Today" : d.toLocaleDateString([], { day: "numeric", month: "short" })}, ${time}`;
};

/* Figma right rail: 50 wide, #101D37; buttons 32 x 32, radius 6, active #285CE0 */
const RAIL: { id: "comments" | "review" | "document" | "present"; label: string; icon: AnyIcon }[] = [
  { id: "comments", label: "Comments", icon: untitled(MessageTextSquare02) },
  { id: "review", label: "Track changes", icon: huge(BinocularsIcon) },
  { id: "document", label: "Formatting pane", icon: untitled(File02) },
  { id: "present", label: "Read-only view", icon: untitled(PresentationChart01) },
];

type Loaded = { sfdt: string; version: number; title: string };

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text || "null");
  } catch {
    return null;
  }
}

/** Word-style document editor (Syncfusion) with the Figma comments panel and dark rail. The document is saved to the
 *  work package through the API, in the editor's own format (format "sfdt"). */
export default function DocEditor({ taskId, projectId }: { taskId: string; projectId: string }) {
  const ref = useRef<DocumentEditorContainerComponent | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ready = useRef(false);
  const quotes = useRef<Record<string, string>>({});
  const versionRef = useRef(0);
  const lastSaved = useRef("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState("");
  const [aiDrafted, setAiDrafted] = useState(false);
  const [status, setStatus] = useState<"saved" | "saving" | "unsaved" | "conflict">("saved");
  const [comments, setComments] = useState<Comment[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draftQuote, setDraftQuote] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const [panel, setPanel] = useState(true);
  const [tracking, setTracking] = useState(false);
  const [props, setProps] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [refsNote, setRefsNote] = useState("");
  /* the work package's findings, keyed by exact claim text — the only mapping the
     document gives us, re-applied on every open and never stored */
  const itemsRef = useRef<EvidenceItem[]>([]);
  const [finding, setFinding] = useState<EvidenceItem | null>(null);

  const de = (): DocumentEditor | null => ref.current?.documentEditor ?? null;
  const boxes = (): CommentElementBox[] => de()?.documentHelper.comments ?? [];
  const findBox = (id: string) => boxes().find((b) => b.commentId === id);

  /* keep Syncfusion's own comment pane closed – the Figma panel replaces it */
  const hidePane = () => {
    const e = de();
    if (e && e.showComments) e.showComments = false;
  };

  const sync = () => {
    setComments(
      boxes().map((b) => ({
        id: b.commentId,
        author: b.author,
        avatar: AVATARS[b.author] ?? "",
        time: fmtTime(b.date),
        quote: quotes.current[b.commentId] ?? "",
        body: b.text,
        resolved: b.isResolved,
        replies: b.replyComments.map((r) => ({
          id: r.commentId,
          author: r.author,
          avatar: AVATARS[r.author] ?? "",
          time: fmtTime(r.date),
          body: r.text,
        })),
      })),
    );
  };

  /* text each comment is anchored to – read once by selecting the range */
  const readQuotes = () => {
    const e = de();
    if (!e) return;
    for (const b of boxes()) {
      try {
        e.selection.selectComment(b);
        quotes.current[b.commentId] = e.selection.text.trim();
      } catch {
        /* comment without a range */
      }
    }
    e.selection.moveToDocumentStart();
    hidePane();
  };

  /* Load the document (in the editor's format) once; it is opened when the editor is created. */
  useEffect(() => {
    let live = true;
    api.workPackageDocument(taskId).then((doc) => {
      if (!live) return;
      const sfdt =
        doc.format === "sfdt" ? doc.body
        : doc.format === "tiptap" ? tiptapToSfdt(safeJson(doc.body))
        : plainToSfdt(doc.body);
      versionRef.current = doc.version;
      lastSaved.current = sfdt;
      setAiDrafted(doc.ai_drafted);
      setLoaded({ sfdt, version: doc.version, title: doc.title });
    }).catch((e) => {
      if (live) setLoadError(e instanceof Error ? e.message : "Could not load the document.");
    });
    return () => { live = false; };
  }, [taskId]);

  const save = async () => {
    const e = de();
    if (!e) return;
    const body = e.serialize();
    if (body === lastSaved.current) {
      setStatus("saved");
      return;
    }
    setStatus("saving");
    try {
      const res = await api.saveWorkPackageDocument(taskId, body, versionRef.current, "sfdt");
      versionRef.current = res.version;
      lastSaved.current = body;
      setAiDrafted(false); // the AI label goes once someone saves their own version
      setStatus("saved");
    } catch (err) {
      setStatus(err instanceof ApiError && err.status === 409 ? "conflict" : "unsaved");
    }
  };

  const scheduleSave = () => {
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 700);
  };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      try {
        de()?.removeEventListener("requestNavigate", handleRequestNavigate);
      } catch {
        /* editor already gone */
      }
    },
    // handleRequestNavigate only reads refs and stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /* Clicking a finding's link inside the document opens its detail in the right
     sidebar — no navigation away from the workspace. Links are internal
     #evidence-<item id> addresses, intercepted here (isHandled stops the editor
     from following them anywhere). */
  const handleRequestNavigate = useCallback((args: { navigationLink: string; isHandled: boolean }) => {
    const m = /^#evidence-(.+)$/.exec(args.navigationLink ?? "");
    if (!m) return;
    args.isHandled = true;
    const item = itemsRef.current.find((i) => i.id === m[1]);
    if (item) {
      setPanel(true);
      setFinding(item);
    }
  }, []);

  /* The document's Findings are plain text, so the links are applied in the editor
     after open(): each finding's claim text is located with the editor search and
     turned into a hyperlink with the same display text. A claim the search cannot
     locate simply stays plain text; user edits to a finding line break its link,
     and the mapping is never stored — it is re-applied on every open. */
  const applyFindingLinks = async () => {
    let items: EvidenceItem[] = [];
    try {
      const r = await api.taskEvidence(taskId);
      items = r.items ?? [];
    } catch {
      return;
    }
    itemsRef.current = items;
    const e = de();
    if (!e) return;
    try {
      for (const item of items) {
        const claim = item.claim_text?.trim();
        if (!claim) continue;
        e.search.findAll(claim);
        const results = e.search.searchResults;
        if (!results || results.length === 0) continue;
        results.index = 0;
        results.navigate();
        e.editor.insertHyperlink(`#evidence-${item.id}`, claim, "View evidence");
      }
      e.search.clearSearchHighlight();
      e.selection.moveToDocumentStart();
    } catch {
      /* a claim the search cannot locate simply stays plain text */
    }
  };

  const onCreated = () => {
    const c = ref.current;
    if (!c || !loaded) return;
    try {
      c.documentEditor.open(loaded.sfdt);
    } catch {
      c.documentEditor.open(INITIAL_SFDT); // unreadable stored copy – start from the template
    }
    c.documentEditor.documentName = loaded.title;
    c.documentEditor.addEventListener("requestNavigate", handleRequestNavigate);
    c.ribbon?.showTab("Developer", false);
    readQuotes();
    sync();
    setActiveId(boxes().find((b) => !b.isResolved)?.commentId ?? null);
    ready.current = true;
    void applyFindingLinks();
  };

  const onChange = () => {
    if (!ready.current) return;
    hidePane();
    sync();
    scheduleSave();
  };

  /* while composing a comment, the quote follows the user's selection */
  const onSelection = () => {
    const e = de();
    if (!e) return;
    const t = e.selection.text.trim();
    /* Selecting a whole finding line (e.g. triple-click) opens its detail too, so a
       finding stays clickable even where the editor wants Ctrl+click for links. While
       a comment is being drafted the selection belongs to the draft instead. */
    if (draftRef.current === null && t) {
      const hit = itemsRef.current.find((i) => i.claim_text.trim() === t);
      if (hit) {
        setPanel(true);
        setFinding(hit);
        return;
      }
    }
    if (draftRef.current === null) return;
    if (t) {
      draftRef.current = t;
      setDraftQuote(t);
    }
  };

  const startNew = () => {
    setPanel(true);
    const t = de()?.selection.text.trim() ?? "";
    draftRef.current = t;
    setDraftQuote(t);
  };

  const cancelNew = () => {
    draftRef.current = null;
    setDraftQuote(null);
  };

  const create = (body: string) => {
    const e = de();
    if (!e || !e.selection.text.trim()) return;
    const before = new Set(boxes().map((b) => b.commentId));
    const quote = e.selection.text.trim();
    e.editor.insertComment(body, { author: CURRENT_USER.name, dateTime: new Date() });
    const added = boxes().find((b) => !before.has(b.commentId));
    if (added) {
      quotes.current[added.commentId] = quote;
      setActiveId(added.commentId);
    }
    hidePane();
    cancelNew();
    sync();
    scheduleSave();
  };

  const reply = (id: string, body: string) => {
    const e = de();
    const b = findBox(id);
    if (!e || !b) return;
    e.editor.replyComment(b, body);
    hidePane();
    sync();
    scheduleSave();
  };

  const resolve = (id: string) => {
    const e = de();
    const b = findBox(id);
    if (!e || !b) return;
    e.editor.resolveComment(b);
    hidePane();
    if (activeId === id) setActiveId(null);
    sync();
    scheduleSave();
  };

  const focusComment = (id: string) => {
    setActiveId(id);
    const e = de();
    const b = findBox(id);
    if (!e || !b) return;
    e.selection.selectComment(b);
    hidePane();
  };

  const rail = (id: (typeof RAIL)[number]["id"]) => {
    const c = ref.current;
    if (!c) return;
    if (id === "comments") setPanel((v) => !v);
    if (id === "review") {
      c.enableTrackChanges = !tracking;
      setTracking(!tracking);
    }
    if (id === "document") {
      c.showPropertiesPane = !props;
      setProps(!props);
    }
    if (id === "present") {
      c.restrictEditing = !readOnly;
      setReadOnly(!readOnly);
    }
  };
  const railOn = { comments: panel, review: tracking, document: props, present: readOnly };

  /* Adds the work package's references at the end of the document. Refuses if the document already has a list, so
     running it twice never duplicates the list. */
  const insertReferences = async () => {
    const c = ref.current;
    if (!c) return;
    setRefsNote("");
    try {
      const refs = await api.taskReferences(taskId);
      if (c.documentEditor.serialize().includes(refs.heading)) {
        setRefsNote("This document already has a references list.");
        return;
      }
      c.documentEditor.selection.moveToDocumentEnd();
      c.documentEditor.editor.paste(tiptapToSfdt(refs.doc));
    } catch {
      setRefsNote("Could not insert the references.");
    }
  };

  const statusText =
    loadError ? loadError
    : status === "conflict" ? "Changed elsewhere. Reload the page to see the latest version."
    : status === "unsaved" ? "Couldn't save. Try again."
    : status === "saving" ? "Saving…"
    : "All changes saved";

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-end justify-between gap-3 px-4 pt-6 pb-4 sm:px-6 lg:px-10">
        <h1 className="text-2xl leading-[1.2] font-semibold tracking-[-0.02em] text-[#101D37] sm:text-[30px]">
          Work Package
        </h1>
        <div className="flex items-center gap-3 pb-1">
          <button
            type="button"
            onClick={() => void insertReferences()}
            disabled={readOnly || !loaded}
            className="rounded-[10px] border border-[#EDEDF0] bg-white px-3 py-1.5 text-xs font-semibold text-[#344054] hover:border-[#D0D5DD] disabled:opacity-60"
          >
            Insert references
          </button>
          <span className="text-[10px] leading-[1.5] tracking-[-0.02em] text-body" aria-live="polite">
            {refsNote && <span className="mr-2 text-[#B42318]">{refsNote}</span>}
            {readOnly && "Read-only · "}
            {tracking && "Tracking changes · "}
            {statusText}
          </span>
        </div>
      </div>
      {aiDrafted && <div role="note" className="mx-4 mb-2 rounded-[12px] border border-[#EDEDF0] bg-[#FAFAFA] p-3 text-xs text-[#344054] sm:mx-6 lg:mx-10">
        <span className="mr-2 rounded-md bg-[#F2F4F7] px-1.5 py-0.5 text-[11px] font-semibold text-[#475467]">AI suggested · review</span>
        Drafted from this work package's details when the project was created. Edit it freely; the label goes away when you save your changes.
      </div>}
      {/* the editor needs a fixed height: viewport minus top bar (64) and title row */}
      <div className="flex h-[calc(100dvh-140px)] min-h-[560px] border-t border-[#EDEDF0]">
        <div className="doc-editor-host min-w-0 flex-1">
          {loaded && (
            <DocumentEditorContainerComponent
              ref={ref}
              height="100%"
              toolbarMode="Ribbon"
              ribbonLayout="Classic"
              fileMenuItems={["New", "Export", "Print"]}
              enableToolbar
              showPropertiesPane={false}
              enableComment
              currentUser={CURRENT_USER.name}
              created={onCreated}
              contentChange={onChange}
              selectionChange={onSelection}
            />
          )}
        </div>
        <div className="hidden shrink-0 lg:flex">
          {panel && (finding ? (
            <FindingDetail item={finding} projectId={projectId} taskId={taskId} onBack={() => setFinding(null)} />
          ) : (
            <CommentsPanel
              comments={comments}
              activeId={activeId}
              draftQuote={draftQuote}
              onFocus={focusComment}
              onStartNew={startNew}
              onCancelNew={cancelNew}
              onCreate={create}
              onReply={reply}
              onResolve={resolve}
            />
          ))}
          <nav className="flex w-[50px] flex-col items-center gap-2 bg-[#101D37] pt-3">
            {RAIL.map((r) => (
              <button
                key={r.id}
                type="button"
                title={r.label}
                aria-label={r.label}
                aria-pressed={railOn[r.id]}
                onClick={() => rail(r.id)}
                className={`flex size-8 items-center justify-center rounded-md ${
                  railOn[r.id] ? "bg-white/15 text-white" : "text-white/90 hover:bg-white/10"
                }`}
              >
                <Icon icon={r.icon} size={16} stroke={1.3} />
              </button>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}
