// The global error module names the layer that failed, so a console report says where to look.
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const g = globalThis as Record<string, any>;

beforeAll(() => {
  g.window = g;
  // eslint-disable-next-line no-new-func
  new Function(fs.readFileSync(path.join(__dirname, "../public/halden-errors.js"), "utf8")).call(g);
});

describe("HaldenErrors.fromResponse", () => {
  const req = { method: "POST", path: "/threads/t/ask", ms: 5 };

  it("reads the AI service's structured error", () => {
    const e = g.HaldenErrors.fromResponse({ ...req, status: 503, body: { detail: {}, error: {
      code: "cross_check_unavailable", message: "Models busy", where: "POST /threads/t/ask", request_id: "abc" } } });
    expect([e.layer, e.code, e.message, e.requestId]).toEqual(["ai", "cross_check_unavailable", "Models busy", "abc"]);
  });

  it("blames the gateway for its own error body", () => {
    const e = g.HaldenErrors.fromResponse({ ...req, status: 502, body: { error: "upstream unavailable" } });
    expect([e.layer, e.code]).toEqual(["gateway", "upstream_unavailable"]);
  });

  it("blames the Next.js proxy for a bare 500", () => {
    const e = g.HaldenErrors.fromResponse({ ...req, status: 500, body: "Internal Server Error" });
    expect([e.layer, e.code]).toEqual(["proxy", "proxy_failed"]);
  });
});
