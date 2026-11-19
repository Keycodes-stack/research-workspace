// Unit tests for the Halden data layer (public/halden-bridge.js + public/vendor/redux-toolkit.min.js).
// The bridge is a plain browser script, so it is evaluated here against a fake API.
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const PUBLIC = path.resolve(__dirname, "../public");
const vendorSrc = fs.readFileSync(path.join(PUBLIC, "vendor/redux-toolkit.min.js"), "utf8");
const bridgeSrc = fs.readFileSync(path.join(PUBLIC, "halden-bridge.js"), "utf8");
const errorsSrc = fs.readFileSync(path.join(PUBLIC, "halden-errors.js"), "utf8");

const PID = "p1";
const PID2 = "p2";
const TOKEN = `x.${Buffer.from(JSON.stringify({ sub: "u1" })).toString("base64")}.y`;

type Route = (url: string, init: RequestInit) => { status?: number; body: unknown };

/** Fake API. Each path answers from `routes`; `calls` counts requests per path. */
function makeFetch(routes: Record<string, Route | unknown>) {
  const calls: Record<string, number> = {};
  const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
    const p = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    calls[p] = (calls[p] ?? 0) + 1;
    const hit = routes[p];
    const isFull = (h: unknown): h is { status: number; body: unknown } =>
      !!h && typeof h === "object" && "status" in h && "body" in h;
    const r = typeof hit === "function" ? (hit as Route)(url, init)
      : isFull(hit) ? hit
      : { body: hit ?? { detail: "not found" }, status: hit === undefined ? 404 : 200 };
    const status = r.status ?? 200;
    return { ok: status < 400, status, text: async () => JSON.stringify(r.body) };
  });
  return { fn, calls };
}

const sourcesFor = (name: string) => ({ sources: [{ id: `s-${name}`, title: `Paper ${name}`, fulltext: "full_text" }] });
const signalsOne = { signals: [{ text: "Signal A", category: "risk", confidence: "high" }] };

function baseRoutes(extra: Record<string, unknown> = {}) {
  return {
    "/projects": { projects: [{ id: PID, name: "Demo", mode: "open_discovery" }, { id: PID2, name: "Other", mode: "open_discovery" }] },
    [`/projects/${PID}/sources`]: sourcesFor("one"),
    [`/projects/${PID}/signals`]: signalsOne,
    [`/projects/${PID}/concepts`]: { concepts: [{ id: "c1", title: "Concept", stage: "ideation", status: "active" }] },
    [`/projects/${PID}/audit`]: { entries: [{ action: "ask", created_at: "2026-11-18T10:00:00Z" }] },
    [`/projects/${PID}/chats`]: { chats: [] },
    [`/projects/${PID2}/sources`]: sourcesFor("two"),
    [`/projects/${PID2}/signals`]: { signals: [] },
    [`/projects/${PID2}/concepts`]: { concepts: [] },
    [`/projects/${PID2}/audit`]: { entries: [] },
    [`/projects/${PID2}/chats`]: { chats: [] },
    ...extra,
  };
}

/** Evaluate the bridge afresh: each test gets its own store and state. */
function loadBridge(fetchFn: unknown) {
  const g = globalThis as Record<string, unknown>;
  g.window = g;
  g.fetch = fetchFn;
  g.__D = { LIB: [], RAD: [], T: [], esc: (s: string) => s };
  g.__V = { S: { route: "home", threads: [], attachments: [], live: false, auditUpdates: undefined }, TITLES: {} };
  g.__renderAll = vi.fn();
  // eslint-disable-next-line no-new-func
  new Function(bridgeSrc).call(g);
  return g.__KC_BRIDGE as { syncFromBackend: () => Promise<void>; switchProject: (id: string) => Promise<void>; createResearch: (t: string, b: string) => Promise<unknown> };
}

/** Wait until `check` is true, polling the store (the fake API answers asynchronously). */
async function until(check: () => boolean, attempts = 400) {
  for (let i = 0; i < attempts; i += 1) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("timed out waiting for condition");
}

const g = globalThis as Record<string, any>;

beforeAll(() => {
  g.window = g;
  // eslint-disable-next-line no-new-func
  new Function(vendorSrc).call(g);
  // eslint-disable-next-line no-new-func
  new Function(errorsSrc).call(g);   // the page loads the error module before the bridge
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("kc_token", TOKEN);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("vendor bundle", () => {
  it("exposes Redux Toolkit with Query on window.RTK", () => {
    expect(typeof g.RTK.configureStore).toBe("function");
    expect(typeof g.RTK.createApi).toBe("function");
  });
});

describe("bridge data layer", () => {
  it("exposes the bridge API and readiness check", () => {
    const { fn } = makeFetch(baseRoutes());
    const bridge = loadBridge(fn);
    expect(typeof bridge.syncFromBackend).toBe("function");
    expect(typeof g.__kcRoute).toBe("function");
    expect(typeof g.__KC_READY).toBe("function");
  });

  it("syncs the project and applies the sources to the library", async () => {
    const { fn, calls } = makeFetch(baseRoutes());
    const bridge = loadBridge(fn);
    await bridge.syncFromBackend();
    g.__kcRoute("home");
    await until(() => g.__KC_READY("home"));
    expect(calls["/projects"]).toBeGreaterThan(0);
    expect(calls[`/projects/${PID}/sources`]).toBe(1);
    expect(g.__D.LIB).toHaveLength(1);
    expect(g.__D.LIB[0].n).toBe("Paper one");
  });

  it("keeps data in the cache: a revisit does not send the request again", async () => {
    const { fn, calls } = makeFetch(baseRoutes());
    const bridge = loadBridge(fn);
    await bridge.syncFromBackend();
    g.__kcRoute("radar");
    await until(() => g.__KC_READY("radar"));
    expect(calls[`/projects/${PID}/signals`]).toBe(1);
    g.__kcRoute("home");
    g.__kcRoute("radar");
    await until(() => g.__KC_READY("radar"));
    expect(calls[`/projects/${PID}/signals`]).toBe(1);
    expect(g.__D.RAD).toHaveLength(1);
  });

  it("refetches once the cached data is older than the cache window", async () => {
    const { fn, calls } = makeFetch(baseRoutes());
    const bridge = loadBridge(fn);
    await bridge.syncFromBackend();
    g.__kcRoute("radar");
    await until(() => g.__KC_READY("radar"));
    // RTK Query judges staleness with `new Date()`, so only the Date clock is moved forward 61 seconds.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 61_000));
    g.__kcRoute("home");
    g.__kcRoute("radar");
    await until(() => calls[`/projects/${PID}/signals`] === 2);
    expect(calls[`/projects/${PID}/signals`]).toBe(2);
  });

  it("a write invalidates cached project data so open screens refetch it", async () => {
    const { fn, calls } = makeFetch(baseRoutes({ "/projects/p1/discover-and-ingest": { sources: [] }, [`/projects/${PID}/tasks`]: { tasks: [] } }));
    const bridge = loadBridge(fn);
    await bridge.syncFromBackend();
    await until(() => g.__KC_READY("home"));
    const before = calls[`/projects/${PID}/sources`];
    await bridge.createResearch("T", "brief").catch(() => undefined);
    await until(() => calls[`/projects/${PID}/sources`] > before);
    expect(calls[`/projects/${PID}/sources`]).toBeGreaterThan(before);
  });

  it("is not ready until the screen's data has settled (drives the skeleton)", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const routes = baseRoutes({
      [`/projects/${PID}/signals`]: async () => { await gate; return { body: signalsOne }; },
    });
    const { fn } = makeFetch(routes);
    const bridge = loadBridge(fn);
    await bridge.syncFromBackend();
    g.__kcRoute("radar");
    expect(g.__KC_READY("radar")).toBe(false);
    release();
    await until(() => g.__KC_READY("radar"));
    expect(g.__KC_READY("radar")).toBe(true);
  });

  it("a failed request settles the screen instead of leaving the skeleton up", async () => {
    const routes = baseRoutes({ [`/projects/${PID}/signals`]: { status: 500, body: { detail: "boom" } } as unknown as Route });
    const { fn } = makeFetch(routes);
    const bridge = loadBridge(fn);
    await bridge.syncFromBackend();
    g.__kcRoute("radar");
    await until(() => g.__KC_READY("radar"));
    expect(g.__KC_READY("radar")).toBe(true);
    expect(g.__D.RAD).toHaveLength(0);
  });

  it("a sync failure stops the skeleton for every screen", async () => {
    const routes = baseRoutes({ "/projects": { status: 500, body: { detail: "down" } } as unknown as Route });
    const { fn } = makeFetch(routes);
    const bridge = loadBridge(fn);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await bridge.syncFromBackend().catch(() => undefined);
    expect(g.__KC_READY("home")).toBe(true);
  });

  it("keeps each project's data separate when switching projects", async () => {
    const { fn } = makeFetch(baseRoutes());
    const bridge = loadBridge(fn);
    await bridge.syncFromBackend();
    g.__kcRoute("home");
    await until(() => g.__KC_READY("home"));
    expect(g.__D.LIB[0].n).toBe("Paper one");
    await bridge.switchProject(PID2);
    g.__kcRoute("home");
    await until(() => g.__KC_READY("home") && g.__D.LIB.length >= 1 && g.__D.LIB[0].n === "Paper two");
    expect(g.__D.LIB.map((x: { n: string }) => x.n)).toEqual(["Paper two"]);
  });
});
