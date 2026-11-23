import { describe, expect, it } from "vitest";
import { EMPTY_PROJECT_DRAFT, applyIntakePatch, isBlankValue } from "@/lib/projectIntake";

describe("AI intake patch", () => {
  it("does not tag or merge empty AI results", () => {
    const draft = { ...EMPTY_PROJECT_DRAFT, name: "Typed by user", objective: "User objective" };
    const { draft: next, suggestedKeys } = applyIntakePatch(draft, {
      lead: "",
      departments: [],
      workstreams: [{ name: "", department: "", team: "", output: "", owner: "", reviewer: "", start: "", due: "", dependencies: "" }],
      objective: "   ",
      name: "",
    });
    expect(suggestedKeys).toEqual([]);
    expect(next.name).toBe("Typed by user");
    expect(next.objective).toBe("User objective");
    expect(next.lead).toBe(EMPTY_PROJECT_DRAFT.lead);
  });

  it("merges and tags real AI values", () => {
    const { draft: next, suggestedKeys } = applyIntakePatch(EMPTY_PROJECT_DRAFT, {
      departments: ["Manufacturing & Operations"],
      budget: "$50k – $100k",
    });
    expect(suggestedKeys.sort()).toEqual(["budget", "departments"]);
    expect(next.departments).toEqual(["Manufacturing & Operations"]);
    expect(next.budget).toBe("$50k – $100k");
  });

  it("never overwrites or tags a field the user filled", () => {
    const draft = { ...EMPTY_PROJECT_DRAFT, budget: "Typed by user" };
    const { draft: next, suggestedKeys } = applyIntakePatch(draft, { budget: "$50k – $100k", lead: "" }, ["budget"]);
    expect(next.budget).toBe("Typed by user");
    expect(suggestedKeys).toEqual([]);
  });

  it("treats object rows with only empty values as blank", () => {
    expect(isBlankValue([{ name: "", owner: "" }])).toBe(true);
    expect(isBlankValue([{ name: "Gate 1", owner: "" }])).toBe(false);
    expect(isBlankValue(null)).toBe(true);
    expect(isBlankValue(false)).toBe(false);
  });
});
