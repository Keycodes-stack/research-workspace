import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AskResult } from "@/lib/types";

const projects = [
  { id: "p1", name: "DNA heat study", mode: "open_discovery", meta: {} },
  { id: "p2", name: "Locked repository", mode: "closed_repository", meta: {} },
];

const answer: AskResult = {
  message_id: "m2", kind: "consensus", reason: "models_agree", content: "", top_similarity: 0.8,
  claims: [
    { text: "Heat separates the DNA strands", chunk_ids: ["c1"], quote: "strands separate above 90 C", conditions: null,
      confirmed: true, match_kind: "exact", match_score: 1, seals: {} },
    { text: "Melting depends on GC content", chunk_ids: ["c2", "c1"], quote: "GC content raises the melting point",
      conditions: "in vitro", confirmed: false, match_kind: "exact", match_score: 1, seals: {} },
  ],
  disagreement: null,
  verification: { status: "complete", verified: 2, purged: 1 },
  gate: { threshold: 0.65, top_similarity: 0.8, passed: true, corrupt_chunks_dropped: 0, evidence_from: "online_search",
          papers_read: 9, online: { found: 50, stored: 9 } },
  chunks: {
    c1: { label: "Thermal DNA melting.pdf, doi:10.1/abc", source_id: "s1", filename: null, doi: "10.1/abc",
          page_start: 3, page_end: 4, sha256: "x", text: "In buffer the strands separate above 90 C.", origin: "openalex",
          url: "https://doi.org/10.1/abc" },
    c2: { label: "GC and stability", source_id: "s2", filename: "gc.pdf", doi: null, page_start: 1, page_end: 1,
          sha256: "y", text: "GC content raises the melting point.", origin: "user_upload", url: null },
  },
  timings: { total_s: 42 },
};

const push = vi.fn();
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), 
  usePathname: () => "/home",
  useRouter: () => ({ push }),
  useParams: () => ({ id: "p1", chatId: "chat1" }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("next/image", () => ({ default: ({ alt }: { alt: string }) => <img alt={alt} /> }));
vi.mock("@/lib/api", () => ({
  api: {
    projects: vi.fn(async () => projects),
    tasks: vi.fn(async () => []),
    chats: vi.fn(async () => []),
    sources: vi.fn(async () => []),
    createChat: vi.fn(async () => ({ id: "chat1", title: "t" })),
    messages: vi.fn(async () => []),
    progress: vi.fn(async () => ["Searching OpenAlex and Europe PMC..."]),
    askOpen: vi.fn(async () => answer),
    upload: vi.fn(async () => ({ source_id: "s9" })),
  },
  getToken: () => "t", setToken: () => {}, consumeTokenFragment: () => {}, ApiError: class extends Error {},
}));

import V2Frame from "@/components/v2/V2Frame";
import HomePage from "@/app/(v2)/(app)/home/page";
import ChatPage from "@/app/(v2)/(app)/projects/[id]/ask/[chatId]/page";
import { api } from "@/lib/api";
import { answerFacts, citeSources, plainContent, readableTitle } from "@/lib/v2/answer";
import { pending, runAsk } from "@/lib/v2/ask";

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); });

describe("answer helpers", () => {
  it("numbers each cited paper once, in order of first citation, and skips unknown passages", () => {
    const { refs, sources } = citeSources(answer.chunks);
    expect(refs(["c1"], "q1")).toEqual([1]);
    expect(refs(["c2", "c1", "gone"], "q2")).toEqual([2, 1]);
    expect(refs(["c1"], "q1")).toEqual([1]);                                  // same passage and quote: not repeated
    const list = sources();
    expect(list.map((s) => [s.n, s.title, s.origin])).toEqual([
      [1, "Thermal DNA melting", "Found via OpenAlex"], [2, "GC and stability", "Uploaded PDF"]]);
    expect(list[0].passages.map((p) => p.pages)).toEqual(["pp. 3–4", "pp. 3–4"]);
    expect(list[0].url).toBe("https://doi.org/10.1/abc");
  });

  it("reads titles, server prefixes and facts the way a person would", () => {
    expect(readableTitle("Paper.pdf, doi:10.9/x")).toBe("Paper");
    expect(readableTitle("")).toBe("Untitled source");
    expect(plainContent("INSUFFICIENT_SOURCE_EVIDENCE: the sources say nothing")).toBe("The sources say nothing");
    expect(answerFacts(answer)).toEqual([
      "New online search: 50 papers found, 9 stored", "9 sources read", "2 claims verified, 1 removed", "42 s"]);
  });
});

describe("runAsk", () => {
  it("tells the user saved sources did not answer, then asks again online", async () => {
    vi.mocked(api.askOpen)
      .mockResolvedValueOnce({ kind: "not_in_saved_sources", note: "No relevant information in 10 saved sources.", saved_sources: 10 })
      .mockResolvedValueOnce(answer);
    const seen: string[][] = [];
    const r = await runAsk("chat1", "Is DNA heat stable?", "both", (s) => seen.push(s));
    expect(r).toBe(answer);
    expect(vi.mocked(api.askOpen).mock.calls).toEqual([
      ["chat1", "Is DNA heat stable?", "both"], ["chat1", "Is DNA heat stable?", "both", "online"]]);
    expect(seen.some((s) => s[0] === "No relevant information in 10 saved sources.")).toBe(true);
  });

  it("keeps answering when the live steps cannot be read, and passes errors on", async () => {
    vi.mocked(api.progress).mockRejectedValue(new Error("offline"));
    await expect(runAsk("chat1", "q?", "uploads", () => {})).resolves.toBe(answer);
    vi.mocked(api.askOpen).mockRejectedValueOnce(new Error("Model B (Mistral) is out of tokens"));
    await expect(runAsk("chat1", "q?", "uploads", () => {})).rejects.toThrow("out of tokens");
  });
});

describe("Home", () => {
  it("offers only projects that take questions and opens a new chat with the question", async () => {
    render(<V2Frame><HomePage /></V2Frame>);
    fireEvent.click(await screen.findByRole("button", { name: /Project/ }));
    expect(screen.getByRole("option", { name: /DNA heat study/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Locked repository/ })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: /DNA heat study/ }));

    fireEvent.click(screen.getByRole("button", { name: /Sources/ }));
    fireEvent.click(screen.getByRole("switch", { name: "Uploaded files" }));   // online only

    const send = screen.getByRole("button", { name: "Send" });
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "ok" } });
    expect(send).toBeDisabled();                                           // fewer than 3 characters
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "Does heat damage DNA?" } });
    fireEvent.click(send);

    // the answer appears on Home itself, with the question and the chosen scope
    const card = await screen.findByRole("article", { name: "Answer" });
    expect(api.createChat).toHaveBeenCalledWith("p1", "Does heat damage DNA?");
    expect(api.askOpen).toHaveBeenCalledWith("chat1", "Does heat damage DNA?", "api");
    expect(within(card).getByText("Heat separates the DNA strands")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(pending.take("chat1")).toBeNull();                              // nothing is handed over any more
    expect(screen.getByRole("link", { name: "Open chat" })).toHaveAttribute("href", "/projects/p1/ask/chat1");
    expect(localStorage.getItem("v2:ask:scope")).toBe("api");
  });

  it("continues the same chat for a follow-up question", async () => {
    render(<V2Frame><HomePage /></V2Frame>);
    fireEvent.click(await screen.findByRole("button", { name: /Project/ }));
    fireEvent.click(screen.getByRole("option", { name: /DNA heat study/ }));
    const ask = async (q: string) => {
      fireEvent.change(screen.getByLabelText("Your question"), { target: { value: q } });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    };
    await ask("Does heat damage DNA?");
    await screen.findAllByRole("article", { name: "Answer" });
    await ask("And at 60 C?");
    await waitFor(() => expect(api.askOpen).toHaveBeenCalledTimes(2));
    expect(api.createChat).toHaveBeenCalledTimes(1);                      // one chat, not one per question
    expect(vi.mocked(api.askOpen).mock.calls[1][0]).toBe("chat1");
  });

  it("shows why a chat could not start", async () => {
    vi.mocked(api.createChat).mockRejectedValueOnce(new Error("chat is available in open-discovery projects"));
    render(<V2Frame><HomePage /></V2Frame>);
    await screen.findByRole("button", { name: /Project.*DNA heat study/ });
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "Does heat damage DNA?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("open-discovery");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("Chat page", () => {
  it("asks the question handed over from Home and shows the answer with numbered sources", async () => {
    pending.put("chat1", "Does heat damage DNA?", "api");
    render(<V2Frame><ChatPage /></V2Frame>);
    expect(await screen.findByText("Does heat damage DNA?", { selector: "div" })).toBeInTheDocument();
    const card = await screen.findByRole("article", { name: "Answer" });
    expect(api.askOpen).toHaveBeenCalledWith("chat1", "Does heat damage DNA?", "api");
    expect(within(card).getByText("Heat separates the DNA strands")).toBeInTheDocument();
    expect(within(card).getByText("Confirmed by both models")).toBeInTheDocument();
    expect(within(card).getByText("One model only")).toBeInTheDocument();
    expect(within(card).getByText("[2][1]")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Thermal DNA melting" })).toHaveAttribute("href", "https://doi.org/10.1/abc");
    expect(pending.take("chat1")).toBeNull();                              // asked once, never again on reload
  });

  it("shows history from the server and the reason when a question fails", async () => {
    vi.mocked(api.messages).mockResolvedValueOnce([
      { id: "u1", role: "user", content: "Earlier question", answer_kind: null, top_similarity: null, created_at: "", final: null },
      { id: "a1", role: "assistant", content: "INSUFFICIENT_SOURCE_EVIDENCE: nothing found", answer_kind: "insufficient_evidence",
        top_similarity: null, created_at: "", final: null },
    ]);
    vi.mocked(api.askOpen).mockRejectedValueOnce(new Error("Model B (Mistral) is out of tokens"));
    render(<V2Frame><ChatPage /></V2Frame>);
    expect(await screen.findByRole("heading", { name: "Earlier question" })).toBeInTheDocument();   // the chat's title
    expect(screen.getByText("Earlier question", { selector: "div" })).toBeInTheDocument();              // and its bubble
    expect(screen.getByText("Nothing found")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "And at 60 C?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Model B (Mistral) is out of tokens")).toBeInTheDocument();
  });
});
