import { describe, expect, it } from "vitest";
import { SseParser } from "@/lib/sse";

describe("SseParser", () => {
  it("parses frames split across chunks and ignores keep-alives", () => {
    const p = new SseParser();
    expect(p.push("event: ready\ndata: {\"a\"")).toEqual([]);
    const f = p.push(":1}\n\n: keep-alive\n\nid: 2\nevent: section\ndata: {\"key\":\"problem\"}\n\n");
    expect(f).toEqual([{ event: "ready", data: "{\"a\":1}", id: undefined }, { event: "section", data: "{\"key\":\"problem\"}", id: "2" }]);
  });
  it("handles CRLF and multi-line data", () => {
    const f = new SseParser().push("event: x\r\ndata: a\r\ndata: b\r\n\r\n");
    expect(f).toEqual([{ event: "x", data: "a\nb", id: undefined }]);
  });
});
