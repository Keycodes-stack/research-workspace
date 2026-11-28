import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue 7a — the Workspace editor showed "Couldn't save. Try again." and
 * then sat there: a transient gateway/network failure was treated as fatal
 * (no retry, no way back except typing again), two saves could fly with the
 * same base version (the second 409ing against the first), and a 409 left the
 * editor stuck on a stale version forever.
 *
 * The save path now: serialises saves (an edit during a save is queued and
 * saved afterwards with the fresh version), retries a transient failure once
 * after 1s, recovers a 409 only when the stored body is exactly what this
 * editor last saved, and offers a Retry button while unsaved.
 */

/* The editor's stylesheet would go through PostCSS in this suite — stub it out. */
vi.mock("@syncfusion/ej2-tailwind3-theme/styles/document-editor-container/index.css", () => ({}));

const sf = vi.hoisted(() => {
  const listeners: Record<string, (...args: never[]) => void> = {};
  const state = { selectionText: "", searchText: "", doc: "sfdt-doc" };
  const searchResults = { length: 0, index: 0, navigate: () => {} };
  const search = { findAll: () => {}, clearSearchHighlight: () => {}, searchResults };
  const selection = {
    get text() { return state.selectionText; },
    set text(v: string) { state.selectionText = v; },
    selectComment: () => {},
    moveToDocumentStart: () => {},
    moveToDocumentEnd: () => {},
    getHyperlinkField: () => null,
    getFieldCode: () => "",
  };
  const editor = {
    insertHyperlinkInternal: () => {},
    removeHyperlink: () => {},
    insertComment: () => {},
    replyComment: () => {},
    resolveComment: () => {},
    paste: () => {},
  };
  const documentEditor = {
    open: () => {},
    serialize: () => state.doc,
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
  return { listeners, state, documentEditor };
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

const apiMock = vi.hoisted(() => ({
  docBody: "sfdt-doc",
  docVersion: 1,
  saveImpl: null as null | ((taskId: string, body: string, baseVersion: number, format: string) => Promise<{ version: number }>),
}));

const { ApiErrorStub } = vi.hoisted(() => {
  class ApiErrorStub extends Error {
    status: number;
    constructor(status: number, detail: unknown, message: string) {
      super(message);
      this.status = status;
    }
  }
  return { ApiErrorStub };
});

vi.mock("@/lib/api", () => ({
  api: {
    workPackageDocument: vi.fn(async () => ({
      format: "sfdt", body: apiMock.docBody, version: apiMock.docVersion, title: "WP doc", ai_drafted: false,
    })),
    taskEvidence: vi.fn(async () => ({ run: null, items: [] })),
    saveWorkPackageDocument: vi.fn((...args: [string, string, number, string]) =>
      (apiMock.saveImpl ? apiMock.saveImpl(...args) : Promise.resolve({ version: 2 }))),
  },
  getToken: () => "t", setToken: () => {}, consumeTokenFragment: () => {},
  ApiError: ApiErrorStub,
}));

import DocEditor from "@/components/v2/workspace/DocEditor";
import { api } from "@/lib/api";

const saveMock = () => vi.mocked(api.saveWorkPackageDocument);

/** Render, flush the document load, and wait for the fake editor to mount. */
const renderEditor = async () => {
  render(<DocEditor taskId="t1" projectId="p1" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByTestId("fake-editor")).toBeInTheDocument();
};

/** Simulate the user editing the document, then let the 700ms debounce fire. */
const editAndFlushDebounce = async (doc: string) => {
  sf.state.doc = doc;
  act(() => { (captured.props?.contentChange as (() => void) | undefined)?.(); });
  expect(screen.getByText("Saving…")).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(700); });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  sf.state.doc = "sfdt-doc";
  sf.state.selectionText = "";
  apiMock.docBody = "sfdt-doc";
  apiMock.docVersion = 1;
  apiMock.saveImpl = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Workspace autosave (issue 7a)", () => {
  it("retries a transient gateway 502 once and then shows saved", async () => {
    let calls = 0;
    apiMock.saveImpl = async () => {
      calls += 1;
      if (calls === 1) throw new ApiErrorStub(502, null, "upstream unavailable");
      return { version: 2 };
    };
    await renderEditor();
    await editAndFlushDebounce("sfdt-edited");
    /* The first attempt failed transiently; the retry fires after 1s. */
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(saveMock()).toHaveBeenCalledTimes(2);
    expect(saveMock()).toHaveBeenNthCalledWith(2, "t1", "sfdt-edited", 1, "sfdt");
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
  });

  it("does not let a second save race the first on the same base version", async () => {
    let resolveFirst!: (v: { version: number }) => void;
    const first = new Promise<{ version: number }>((resolve) => { resolveFirst = resolve; });
    let calls = 0;
    apiMock.saveImpl = async () => {
      calls += 1;
      return calls === 1 ? first : { version: 3 };
    };
    await renderEditor();
    await editAndFlushDebounce("edit-1");
    expect(saveMock()).toHaveBeenCalledTimes(1);
    /* A second edit while the first save is still in flight: queued, not raced. */
    await editAndFlushDebounce("edit-2");
    expect(saveMock()).toHaveBeenCalledTimes(1);
    await act(async () => { resolveFirst({ version: 2 }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(saveMock()).toHaveBeenCalledTimes(2);
    /* The queued save re-serialises the latest body with the fresh version. */
    expect(saveMock()).toHaveBeenNthCalledWith(2, "t1", "edit-2", 2, "sfdt");
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
  });

  it("recovers a 409 when the stored body is exactly what this editor last saved", async () => {
    let calls = 0;
    apiMock.saveImpl = async () => {
      calls += 1;
      if (calls === 1) throw new ApiErrorStub(409, null, "changed by someone else");
      return { version: 6 };
    };
    /* The stored copy is our own last save, at a newer version: our earlier
       save landed but its response was lost. */
    apiMock.docBody = "sfdt-doc";
    apiMock.docVersion = 5;
    await renderEditor();
    await editAndFlushDebounce("sfdt-edited");
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(saveMock()).toHaveBeenCalledTimes(2);
    expect(saveMock()).toHaveBeenNthCalledWith(2, "t1", "sfdt-edited", 5, "sfdt");
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
  });

  it("keeps a genuine 409 as a conflict and does not overwrite the other change", async () => {
    apiMock.saveImpl = async () => { throw new ApiErrorStub(409, null, "changed by someone else"); };
    await renderEditor();
    /* Someone else really did change the document after we loaded it. */
    apiMock.docBody = "sfdt-someone-else";
    apiMock.docVersion = 7;
    await editAndFlushDebounce("sfdt-edited");
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(saveMock()).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Changed elsewhere. Reload the page to see the latest version.")).toBeInTheDocument();
  });

  it("shows a Retry button after a persistent failure, and Retry saves", async () => {
    apiMock.saveImpl = async () => { throw new ApiErrorStub(502, null, "upstream unavailable"); };
    await renderEditor();
    await editAndFlushDebounce("sfdt-edited");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(saveMock()).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Couldn't save. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    /* The gateway is back: Retry saves the still-unsaved edits. */
    apiMock.saveImpl = async () => ({ version: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
  });
});
