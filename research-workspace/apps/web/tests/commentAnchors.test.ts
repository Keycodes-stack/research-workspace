import { describe, expect, it } from "vitest";
import { commentIdsIn } from "@/components/v2/projects/RichEditor";

describe("comment anchors in a document", () => {
  it("finds the ids of comments anchored in the text", () => {
    const doc = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [
      { type: "text", text: "Plain " },
      { type: "text", text: "anchored", marks: [{ type: "comment", attrs: { id: "c-1" } }] },
      { type: "text", text: " and", marks: [{ type: "bold" }] },
    ] }] });
    expect([...commentIdsIn(doc)]).toEqual(["c-1"]);
  });

  it("returns nothing for a plain-text or broken document", () => {
    expect(commentIdsIn("just some plain text").size).toBe(0);
    expect(commentIdsIn("").size).toBe(0);
  });
});
