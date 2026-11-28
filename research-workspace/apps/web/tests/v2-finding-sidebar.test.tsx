import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvidenceItem } from "@/lib/types";

/**
 * Findings live inside the document now: the editor links each finding's claim
 * text to its evidence item at load time, and clicking a link opens that
 * finding's detail in the workspace right sidebar (no navigation, no new tab).
 * The separate Findings panel above the editor is gone.
 */

/* The editor's stylesheet would go through PostCSS in this suite — stub it out. */
vi.mock("@syncfusion/ej2-tailwind3-theme/styles/document-editor-container/index.css", () => ({}));

const sf = vi.hoisted(() => {
  const listeners: Record<string, (...args: never[]) => void> = {};
  const hyperlinkCalls: Array<{ address: string; displayText?: string; remove: boolean; isBookmark?: boolean }> = [];
  const state = { selectionText: "", searchText: "", fieldCode: null as string | null, removeHyperlinkCalls: 0 };
  const searchResults = {
    length: 0,
    index: 0,
    navigate: () => { state.selectionText = state.searchText; },
  };
  const search = {
    findAll: (text: string) => { state.searchText = text; searchResults.length = text ? 1 : 0; },
    clearSearchHighlight: () => {},
    searchResults,
  };
  const selection = {
    get text() { return state.selectionText; },
    set text(v: string) { state.selectionText = v; },
    selectComment: () => {},
    moveToDocumentStart: () => {},
    moveToDocumentEnd: () => {},
    /* null = the found text is plain; a string = it sits inside a hyperlink
       field with that field code. Tests set state.fieldCode to simulate a
       stale link saved in the document. */
    getHyperlinkField: () => (state.fieldCode === null ? null : ({} as never)),
    getFieldCode: () => state.fieldCode ?? "",
  };
  const editor = {
    insertHyperlinkInternal: (address: string, displayText?: string, remove?: boolean, isBookmark?: boolean) => {
      hyperlinkCalls.push({ address, displayText, remove: remove ?? false, isBookmark });
    },
    removeHyperlink: () => { state.removeHyperlinkCalls += 1; },
    insertComment: () => {},
    replyComment: () => {},
    resolveComment: () => {},
    paste: () => {},
  };
  const documentEditor = {
    open: () => {},
    serialize: () => "sfdt-doc",
    documentName: "",
    documentHelper: { comments: [] as never[] },
    showComments: false,
    useCtrlClickToFollowHyperlink: true,
    selection,
    search,
    editor,
    addEventListener: (name: string, fn: (...args: never[]) => void) => { listeners[name] = fn; },
    removeEventListener: (name: string) => { delete listeners[name]; },
  };
  return { listeners, hyperlinkCalls, state, documentEditor };
});
const captured = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));

vi.mock("@syncfusion/ej2-react-documenteditor", () => {
  const FakeContainer = React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
    captured.props = props;
    React.useEffect(() => {
      const target = { documentEditor: sf.documentEditor, ribbon: { showTab: () => {} } };
      if (typeof ref === "function") ref(target);
      else if (ref && typeof ref === "object") (ref as { current: unknown }).current = target;
      (props.created as (() => void) | undefined)?.();
    }, []);
    return <div data-testid="fake-editor" />;
  });
  return {
    DocumentEditorContainerComponent: Object.assign(FakeContainer, { Inject: () => {} }),
    Ribbon: () => null,
    Toolbar: () => null,
  };
});
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("next/image", () => ({ default: ({ alt }: { alt: string }) => <img alt={alt} /> }));

const item1: EvidenceItem = {
  id: "e1", evidence_id: "Evidence 001", task_id: "t1", work_package_code: "WP-1", work_package_title: "Chassis research",
  claim_text: "Aluminium reduces chassis mass.", quote: "aluminium alloys reduce mass by 20%", status: "verified",
  found_by: ["model_a", "model_b"], confirmed: true, chunk_ids: ["c1"], source_id: "s1",
  source_title: "Alloy study", doi: "10.1/a", source_url: "https://doi.org/10.1/a", origin: "openalex",
  pub_year: 2024, created_at: null,
};
const item2: EvidenceItem = {
  id: "e2", evidence_id: "Evidence 002", task_id: "t1", work_package_code: "WP-1", work_package_title: "Chassis research",
  claim_text: "Steel is cheaper per kilogram.", quote: "", status: "pending", found_by: ["model_b"], confirmed: false,
  chunk_ids: [], source_id: null, source_title: "Steel report", doi: null, source_url: null, origin: "user_upload",
  pub_year: null, created_at: null,
};

vi.mock("@/lib/api", () => ({
  api: {
    workPackageDocument: vi.fn(async () => ({ format: "sfdt", body: "sfdt-doc", version: 1, title: "WP doc", ai_drafted: false })),
    taskEvidence: vi.fn(async () => ({ run: null, items: [item1, item2] })),
    saveWorkPackageDocument: vi.fn(async () => ({ version: 2 })),
  },
  getToken: () => "t", setToken: () => {}, consumeTokenFragment: () => {}, ApiError: class extends Error {},
}));

import DocEditor from "@/components/v2/workspace/DocEditor";

beforeEach(() => {
  vi.clearAllMocks();
  sf.hyperlinkCalls.length = 0;
  sf.state.selectionText = "";
  sf.state.searchText = "";
  sf.state.fieldCode = null;
  sf.state.removeHyperlinkCalls = 0;
  sf.documentEditor.useCtrlClickToFollowHyperlink = true;
});

describe("Findings inside the document open the right sidebar", () => {
  it("links each finding's claim text to its evidence item at load time, as a bookmark link", async () => {
    render(<DocEditor taskId="t1" projectId="p1" />);
    await waitFor(() => expect(sf.hyperlinkCalls).toHaveLength(2));
    /* Bookmark links (`HYPERLINK \l "evidence-<id>"`), not `#evidence-<id>`
       web-style addresses: the container pops an "address of this site is not
       valid" dialog for anything that is not a Bookmark link. */
    expect(sf.hyperlinkCalls[0]).toEqual({ address: 'evidence-e1" \\o "View evidence', displayText: "Aluminium reduces chassis mass.", remove: false, isBookmark: true });
    expect(sf.hyperlinkCalls[1]).toEqual({ address: 'evidence-e2" \\o "View evidence', displayText: "Steel is cheaper per kilogram.", remove: false, isBookmark: true });
  });

  it("turns off Ctrl+click for hyperlinks, so a plain click follows a finding link", async () => {
    render(<DocEditor taskId="t1" projectId="p1" />);
    await waitFor(() => expect(sf.hyperlinkCalls).toHaveLength(2));
    expect(sf.documentEditor.useCtrlClickToFollowHyperlink).toBe(false);
  });

  it("clicking a finding link shows its detail in the sidebar, with a way back to Comments", async () => {
    render(<DocEditor taskId="t1" projectId="p1" />);
    await waitFor(() => expect(sf.hyperlinkCalls).toHaveLength(2));
    /* What the editor reports for a bookmark link: the id in localReference,
       linkType Bookmark, no navigation link. */
    const args = { navigationLink: "", localReference: "evidence-e2", linkType: "Bookmark", isHandled: false };
    act(() => { sf.listeners["requestNavigate"]?.(args as never); });
    expect(args.isHandled).toBe(true);
    expect(await screen.findByText("Steel is cheaper per kilogram.")).toBeInTheDocument();
    expect(screen.getByText("Pending verification")).toBeInTheDocument();
    expect(screen.getByText("(one model only)")).toBeInTheDocument();
    expect(screen.getByText("Evidence 002 · Steel report")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View in Evidence →" })).toHaveAttribute(
      "href", "/projects/p1/evidence?work_package=t1",
    );
    expect(screen.queryByText("No open comments. Select text and click “New”.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "← Comments" }));
    expect(await screen.findByText("No open comments. Select text and click “New”.")).toBeInTheDocument();
    expect(screen.queryByText("Steel is cheaper per kilogram.")).not.toBeInTheDocument();
  });

  it("selecting a whole finding line opens its detail too (selection fallback)", async () => {
    render(<DocEditor taskId="t1" projectId="p1" />);
    await waitFor(() => expect(sf.hyperlinkCalls).toHaveLength(2));
    sf.state.selectionText = "Aluminium reduces chassis mass.";
    act(() => { (captured.props?.selectionChange as (() => void) | undefined)?.(); });
    expect(await screen.findByText("Aluminium reduces chassis mass.")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByText("Evidence 001 · Alloy study")).toBeInTheDocument();
  });

  it("ignores navigation links that are not finding links", async () => {
    render(<DocEditor taskId="t1" projectId="p1" />);
    await waitFor(() => expect(sf.hyperlinkCalls).toHaveLength(2));
    const args = { navigationLink: "https://example.com/paper", isHandled: false };
    act(() => { sf.listeners["requestNavigate"]?.(args as never); });
    expect(args.isHandled).toBe(false);
    expect(await screen.findByText("No open comments. Select text and click “New”.")).toBeInTheDocument();
  });

  it("still opens the sidebar for a legacy #evidence- navigation link", async () => {
    render(<DocEditor taskId="t1" projectId="p1" />);
    await waitFor(() => expect(sf.hyperlinkCalls).toHaveLength(2));
    const args = { navigationLink: "#evidence-e1", isHandled: false };
    act(() => { sf.listeners["requestNavigate"]?.(args as never); });
    expect(args.isHandled).toBe(true);
    expect(await screen.findByText("Aluminium reduces chassis mass.")).toBeInTheDocument();
    expect(screen.getByText("Evidence 001 · Alloy study")).toBeInTheDocument();
  });

  it("removes a stale #evidence- link saved in the document before re-linking it", async () => {
    sf.state.fieldCode = 'HYPERLINK "#evidence-e1" \\o "View evidence"';
    render(<DocEditor taskId="t1" projectId="p1" />);
    await waitFor(() => expect(sf.hyperlinkCalls).toHaveLength(2));
    /* Both claims sat inside a stale finding link, so both fields are removed;
       the bookmark links are still applied afterwards. */
    expect(sf.state.removeHyperlinkCalls).toBe(2);
    expect(sf.hyperlinkCalls[0].isBookmark).toBe(true);
    expect(sf.hyperlinkCalls[1].isBookmark).toBe(true);
  });

  it("leaves a non-finding hyperlink on the claim text alone", async () => {
    sf.state.fieldCode = 'HYPERLINK "https://example.com/paper"';
    render(<DocEditor taskId="t1" projectId="p1" />);
    await waitFor(() => expect(sf.hyperlinkCalls).toHaveLength(2));
    expect(sf.state.removeHyperlinkCalls).toBe(0);
  });
});

/* The separate Findings panel above the editor is gone: the Workspace renders
   the editor directly, and the editor gets the project id for its sidebar links. */
const workspaceStub = vi.hoisted(() => ({ docEditorProps: null as Record<string, unknown> | null }));
vi.mock("next/dynamic", () => ({
  default: () => {
    const Stub = (props: Record<string, unknown>) => {
      workspaceStub.docEditorProps = props;
      return <div data-testid="doc-editor-stub" />;
    };
    return Stub;
  },
}));
vi.mock("@/components/v2/dashboard/TopBar", () => ({ default: () => null }));
vi.mock("@/components/v2/dashboard/ProjectsPanel", () => ({ default: () => null }));

import WorkPackageWorkspace from "@/components/v2/projects/WorkPackageWorkspace";

describe("Findings panel removed", () => {
  it("the Workspace shows no Findings panel above the editor and passes the project id to the editor", () => {
    render(<WorkPackageWorkspace projectId="p1" taskId="t1" />);
    expect(screen.getByTestId("doc-editor-stub")).toBeInTheDocument();
    expect(workspaceStub.docEditorProps).toEqual({ taskId: "t1", projectId: "p1" });
    expect(screen.queryByRole("heading", { name: /Findings/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Click a finding to open the evidence/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show findings|Hide findings/ })).not.toBeInTheDocument();
  });
});
