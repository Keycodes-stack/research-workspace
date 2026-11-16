import type { AppNotification } from "./types";

/** Initial notifications. Bodies use `{title}` so the task title always reflects current data. */
export const SEED: AppNotification[] = [
  { id: "n1", k: "agent", t: "t102", h: "Agents finished the cooling comparison", b: "“{title}” is ready for review. 34 sources cited, accuracy 92%.", w: "12 min ago", g: "Today", u: 1, a: ["Review", "Open"] },
  { id: "n2", k: "mention", who: "sara", t: "t101", h: "Sara Malik mentioned you", b: "“@Bill can you confirm the yield range before Friday?”", w: "2 h ago", g: "Today", u: 1, a: ["Reply"] },
  { id: "n3", k: "claim", who: "sara", t: "t101", h: "A claim was flagged as disputed", b: "The yield figure in “{title}” is contradicted by a second source.", w: "3 h ago", g: "Today", u: 1, a: ["Check claim"] },
  { id: "n4", k: "blocker", t: "t108", h: "Blocker added", b: "The supplier test report is outstanding for “{title}”.", w: "Yesterday", g: "Earlier", u: 0, a: ["Open"] },
  { id: "n5", k: "approval", who: "tomas", t: "t106", h: "Tomás signed off the margin model", b: "“{title}” can go to the VP for approval.", w: "Yesterday", g: "Earlier", u: 0, a: ["Send to VP"] },
  { id: "n6", k: "system", h: "3 sources indexed", b: "Your uploaded files are parsed and ready to cite.", w: "Yesterday", g: "Earlier", u: 0, a: [] },
];

/** Notifications that arrive after load. Stable ids make delivery idempotent across reloads and tabs. */
export const LIVE_QUEUE: AppNotification[] = [
  { id: "nq1", k: "mention", who: "priya", t: "t104", h: "Dr. Priya Nair commented", b: "“Approving once dual sourcing is written into the plan.”", w: "just now", g: "Today", u: 1, a: ["Reply"] },
];

/** Fills `{title}` from `titleOf`; when the task is unknown, reads naturally as "this task". */
export const resolveBody = (n: AppNotification, titleOf: (taskId: string) => string = () => ""): string => {
  const title = n.t ? titleOf(n.t) : "";
  return title ? n.b.replace("{title}", title) : n.b.replace("“{title}”", "this task").replace("{title}", "this task");
};
