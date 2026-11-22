"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_PANEL } from "./ai/models";

/*
 * Knowledge Library – the repositories research draws on, plus the model panel that
 * reasons over them. Inspired by the Keycodes / Halden demos; state lives in this browser.
 */

export type Repo = {
  id: string;
  name: string;
  kind: "Scholarly" | "Patents" | "News" | "Drive" | "Upload" | "Web";
  active: boolean;
  lastUsed: string;
  records: number;
  added: string;
};

export type Connector = {
  id: string;
  name: string;
  desc: string;
  connected: boolean;
};

export type Clip = {
  id: string;
  text: string;
  source: string;
  project: string;
  saved: string;
};

/* model panels live in lib/ai/models (shared with the server routes) */
export { MODEL_PANELS, panelFor, type ModelPanel } from "./ai/models";

export const REASONING = [
  { id: "balanced", name: "Balanced", desc: "Good answers at normal speed" },
  {
    id: "deep",
    name: "Deep reasoning",
    desc: "Slower; checks every claim against two sources",
  },
  { id: "fast", name: "Fast", desc: "Quick first draft, fewer cross-checks" },
];

const REPOS: Repo[] = [
  {
    id: "r1",
    name: "Google Scholar",
    kind: "Scholarly",
    active: true,
    lastUsed: "8 Nov 2026",
    records: 34,
    added: "2 Mar 2026",
  },
  {
    id: "r2",
    name: "IEEE Xplore",
    kind: "Scholarly",
    active: true,
    lastUsed: "7 Nov 2026",
    records: 27,
    added: "2 Mar 2026",
  },
  {
    id: "r3",
    name: "Lens.org (patents)",
    kind: "Patents",
    active: true,
    lastUsed: "6 Nov 2026",
    records: 21,
    added: "11 May 2026",
  },
  {
    id: "r4",
    name: "BASE (Bielefeld Academic Search Engine)",
    kind: "Scholarly",
    active: true,
    lastUsed: "29 Oct 2026",
    records: 12,
    added: "6 May 2026",
  },
  {
    id: "r5",
    name: "Microsoft OneDrive",
    kind: "Drive",
    active: true,
    lastUsed: "9 Nov 2026",
    records: 15,
    added: "1 Jun 2026",
  },
  {
    id: "r6",
    name: "Washington Post",
    kind: "News",
    active: false,
    lastUsed: "4 Oct 2026",
    records: 6,
    added: "9 Jun 2026",
  },
  {
    id: "r7",
    name: "Microsoft Academic",
    kind: "Scholarly",
    active: false,
    lastUsed: "18 Aug 2026",
    records: 9,
    added: "2 Mar 2026",
  },
  {
    id: "r8",
    name: "New York Times",
    kind: "News",
    active: false,
    lastUsed: "21 Sep 2026",
    records: 4,
    added: "9 Jun 2026",
  },
];

const CONNECTORS: Connector[] = [
  { id: "patents", name: "Patents", desc: "USPTO, EPO, WIPO", connected: true },
  {
    id: "journals",
    name: "Journals",
    desc: "Peer-reviewed publishers",
    connected: true,
  },
  {
    id: "web",
    name: "Web / News",
    desc: "Live web and news search",
    connected: true,
  },
  {
    id: "drive",
    name: "Company Drive",
    desc: "SharePoint, Google Drive",
    connected: false,
  },
  { id: "slack", name: "Slack", desc: "Selected channels", connected: false },
];

export const APPROVED = [
  {
    title: "Heat recovery: integrated feasibility study",
    project: "Industrial Heat Recovery",
    approvedBy: "Ibrahim Ghatila",
    date: "12 Nov 2026",
    claims: 14,
  },
  {
    title: "Hydrogen storage technology comparison",
    project: "Hydrogen Energy Feasibility",
    approvedBy: "Omar Patel",
    date: "4 Nov 2026",
    claims: 9,
  },
  {
    title: "Bearing failure root-cause review",
    project: "Industrial Reliability Program",
    approvedBy: "Sarah Chen",
    date: "28 Oct 2026",
    claims: 11,
  },
];

export const METHODOLOGIES = [
  {
    name: "Technical Feasibility Assessment",
    usedFor: "Technical options, constraints, risks and practicality",
    stages: 4,
  },
  {
    name: "Literature Review",
    usedFor: "Structured assessment of existing publications and evidence",
    stages: 6,
  },
  {
    name: "Comparative Technology Assessment",
    usedFor: "Compare solutions against agreed criteria and evidence",
    stages: 6,
  },
  {
    name: "Experimental Research",
    usedFor: "Hypotheses, controlled tests, results and validation",
    stages: 5,
  },
  {
    name: "Simulation & Modeling",
    usedFor: "Models, assumptions, validation and uncertainty",
    stages: 5,
  },
  {
    name: "Technology & Patent Landscape",
    usedFor: "Map published technologies, patents and players",
    stages: 4,
  },
];

const CLIPS: Clip[] = [
  {
    id: "c1",
    text: "Waste-heat recovery from compressor cooling loops returned 18–24% of input energy across the three pilot sites.",
    source: "IEEE Xplore",
    project: "Industrial Heat Recovery",
    saved: "10 Nov 2026",
  },
  {
    id: "c2",
    text: "Electrolyser stack degradation stayed below 1.2% per 1,000 hours when operated under 80% nominal load.",
    source: "Google Scholar",
    project: "Hydrogen Energy Feasibility",
    saved: "6 Nov 2026",
  },
];

/* ---------------- store (localStorage, shared by every component on the page) ---------------- */

export type KnowledgeState = {
  repos: Repo[];
  connectors: Connector[];
  clips: Clip[];
  /** research defaults used by the prompts */
  useUploads: boolean;
  useOnline: boolean;
  panel: string;
  reasoning: string;
};

const KEY = "knowledge:v1";
const DEFAULT: KnowledgeState = {
  repos: REPOS,
  connectors: CONNECTORS,
  clips: CLIPS,
  useUploads: true,
  useOnline: true,
  panel: DEFAULT_PANEL,
  reasoning: REASONING[0].id,
};

let state: KnowledgeState = DEFAULT;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw)
      state = { ...DEFAULT, ...(JSON.parse(raw) as Partial<KnowledgeState>) };
  } catch {
    /* damaged data – keep defaults */
  }
}

export function updateKnowledge(
  fn: (s: KnowledgeState) => Partial<KnowledgeState>,
) {
  load();
  state = { ...state, ...fn(state) };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full / unavailable */
  }
  listeners.forEach((l) => l());
}

export function useKnowledge(): KnowledgeState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => {
      load();
      return state;
    },
    () => DEFAULT,
  );
}

export const today = () =>
  new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
