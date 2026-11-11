import { describe, expect, it } from "vitest";
import { highlight, pageLabel } from "@/lib/highlight";

const passage = "The reagent was stable for 12 weeks\nat 4 °C in amber vials. It must not be frozen.";

describe("highlight", () => {
  it("marks a quote across a line break, ignoring case", () => {
    const s = highlight(passage, "Stable for 12 weeks at 4 °C")!;
    expect(s.filter((x) => x.mark).map((x) => x.text)).toEqual(["stable for 12 weeks\nat 4 °C"]);
    expect(s.map((x) => x.text).join("")).toBe(passage);
  });
  it("marks ordered ellipsis segments and rejects wrong order", () => {
    const s = highlight(passage, "The reagent ... must not be frozen")!;
    expect(s.filter((x) => x.mark).map((x) => x.text)).toEqual(["The reagent", "must not be frozen"]);
    expect(highlight(passage, "must not be frozen ... The reagent")).toBeNull();
  });
  it("returns null when not literally present and escapes regex characters", () => {
    expect(highlight(passage, "stable for 14 weeks")).toBeNull();
    expect(highlight("cost (approx.) $5+", "(approx.) $5+")).not.toBeNull();
    expect(highlight(passage, "")).toBeNull();
  });
});

describe("pageLabel", () => {
  it("formats", () => {
    expect(pageLabel(3, 3)).toBe("p. 3");
    expect(pageLabel(3, 4)).toBe("pp. 3–4");
    expect(pageLabel(null, null)).toBeNull();
  });
});
