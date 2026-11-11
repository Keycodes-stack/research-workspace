export interface ExportForm {
  title: string; preparedBy: string; organization: string;
  includeFinancial: boolean;
  currency: string; horizon: string; upfront: string; benefit: string; running: string;
  growth: string; discount: string; note: string;
}

export const EMPTY_FORM: ExportForm = {
  title: "", preparedBy: "", organization: "", includeFinancial: false,
  currency: "USD", horizon: "5", upfront: "", benefit: "", running: "", growth: "0", discount: "0", note: "",
};

export interface ExportBody {
  title?: string; prepared_by?: string; organization?: string;
  financial?: {
    currency: string; horizon_years: number; upfront_cost: number; annual_benefit: number;
    annual_running_cost: number; benefit_growth_pct: number; discount_rate_pct: number; note?: string;
  };
}

/** Parse "1,250.50" / "" -> number. Returns null when not a finite number. */
export function num(s: string, emptyAs: number | null = null): number | null {
  const t = s.trim().replace(/,/g, "");
  if (t === "") return emptyAs;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** Build the request body, or an error message for the first invalid field. */
export function buildExportBody(f: ExportForm): { body: ExportBody } | { error: string } {
  const body: ExportBody = {};
  if (f.title.trim()) body.title = f.title.trim();
  if (f.preparedBy.trim()) body.prepared_by = f.preparedBy.trim();
  if (f.organization.trim()) body.organization = f.organization.trim();
  if (!f.includeFinancial) return { body };

  const fields: [string, string, number, number, number | null][] = [
    // label, raw, min, max, emptyAs (null = required)
    ["Upfront cost", f.upfront, 0, 1e12, 0], ["Annual benefit", f.benefit, 0, 1e12, 0],
    ["Annual running cost", f.running, 0, 1e12, 0], ["Benefit growth", f.growth, -50, 100, 0],
    ["Discount rate", f.discount, 0, 100, 0],
  ];
  const v: number[] = [];
  for (const [label, raw, min, max, empty] of fields) {
    const n = num(raw, empty);
    if (n === null) return { error: `${label} must be a number.` };
    if (n < min || n > max) return { error: `${label} must be between ${min} and ${max}.` };
    v.push(n);
  }
  const years = num(f.horizon);
  if (years === null || !Number.isInteger(years) || years < 1 || years > 20) return { error: "Horizon must be a whole number of years from 1 to 20." };
  const cur = f.currency.trim().toUpperCase();
  if (!cur || cur.length > 8) return { error: "Currency is required (for example USD)." };
  if (v[0] === 0 && v[1] === 0 && v[2] === 0) return { error: "Enter at least one amount, or untick the financial projection." };

  body.financial = {
    currency: cur, horizon_years: years, upfront_cost: v[0], annual_benefit: v[1], annual_running_cost: v[2],
    benefit_growth_pct: v[3], discount_rate_pct: v[4], ...(f.note.trim() ? { note: f.note.trim() } : {}),
  };
  return { body };
}
