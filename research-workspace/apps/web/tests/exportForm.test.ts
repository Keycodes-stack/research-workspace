import { describe, expect, it } from "vitest";
import { EMPTY_FORM, buildExportBody, num } from "@/lib/exportForm";

const fin = { ...EMPTY_FORM, includeFinancial: true, upfront: "1,000", benefit: "600", running: "100", horizon: "3" };

describe("num", () => {
  it("parses commas and rejects junk", () => {
    expect(num("1,250.50")).toBe(1250.5);
    expect(num("")).toBeNull();
    expect(num("", 0)).toBe(0);
    expect(num("12abc")).toBeNull();
    expect(num("-5")).toBe(-5);
  });
});

describe("buildExportBody", () => {
  it("omits financial data unless ticked and drops blank text", () => {
    expect(buildExportBody({ ...EMPTY_FORM, title: " T ", preparedBy: "" })).toEqual({ body: { title: "T" } });
    expect("financial" in (buildExportBody({ ...fin, includeFinancial: false }) as { body: object }).body).toBe(false);
  });
  it("builds a numeric financial block", () => {
    const r = buildExportBody({ ...fin, currency: "eur", note: " n " }) as { body: { financial: Record<string, unknown> } };
    expect(r.body.financial).toEqual({
      currency: "EUR", horizon_years: 3, upfront_cost: 1000, annual_benefit: 600, annual_running_cost: 100,
      benefit_growth_pct: 0, discount_rate_pct: 0, note: "n",
    });
  });
  it("reports the first invalid field", () => {
    expect(buildExportBody({ ...fin, upfront: "abc" })).toEqual({ error: "Upfront cost must be a number." });
    expect(buildExportBody({ ...fin, discount: "101" })).toEqual({ error: "Discount rate must be between 0 and 100." });
    expect(buildExportBody({ ...fin, horizon: "2.5" })).toMatchObject({ error: expect.stringContaining("Horizon") });
    expect(buildExportBody({ ...fin, horizon: "21" })).toMatchObject({ error: expect.stringContaining("Horizon") });
    expect(buildExportBody({ ...fin, currency: " " })).toMatchObject({ error: expect.stringContaining("Currency") });
    expect(buildExportBody({ ...fin, upfront: "", benefit: "", running: "" })).toMatchObject({ error: expect.stringContaining("at least one amount") });
  });
});
