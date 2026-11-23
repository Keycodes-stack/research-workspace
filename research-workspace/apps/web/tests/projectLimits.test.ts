import { describe, expect, it } from "vitest";
import { EMPTY_PROJECT_DRAFT, charterOverLimits, FIELD_LIMITS } from "@/lib/projectIntake";

describe("charter limits", () => {
  it("accepts a draft that fits every limit", () => {
    expect(charterOverLimits({ ...EMPTY_PROJECT_DRAFT, objective: "Assess solar." })).toEqual([]);
  });
  it("reports text over its limit instead of trimming it", () => {
    const over = "x".repeat(FIELD_LIMITS.objective + 1);
    expect(charterOverLimits({ ...EMPTY_PROJECT_DRAFT, objective: over })).toEqual([
      `objective (${FIELD_LIMITS.objective + 1} of ${FIELD_LIMITS.objective} characters)`,
    ]);
  });
  it("reports too many workstreams and long workstream fields", () => {
    const row = { name: "a", department: "", team: "", output: "", owner: "", reviewer: "", start: "", due: "", dependencies: "" };
    const problems = charterOverLimits({ ...EMPTY_PROJECT_DRAFT, workstreams: Array.from({ length: 9 }, () => row) });
    expect(problems).toEqual(["workstreams (9 of at most 8)"]);
  });
});
