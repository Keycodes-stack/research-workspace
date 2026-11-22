export type EventStatus = "Draft" | "Scheduled" | "Active" | "Ended";

export type CalEvent = {
  id: string;
  title: string;
  /** ISO dates (YYYY-MM-DD), inclusive */
  start: string;
  end: string;
  status: EventStatus;
  progress: number;
  /** extra people beyond the two avatars */
  more: number;
  /* Google-Calendar-style details (all optional, older saved events don't have them) */
  allDay?: boolean;
  /** "HH:MM" */
  startTime?: string;
  endTime?: string;
  repeat?: string;
  /** invited people (names or email addresses) */
  guests?: string[];
  meetLink?: string;
  location?: string;
  /** agenda / description */
  agenda?: string;
  reminder?: string;
};

export const REPEATS = ["Does not repeat", "Daily", "Weekly on this day", "Every 2 weeks", "Monthly"];
export const REMINDERS = ["No reminder", "10 minutes before", "30 minutes before", "1 hour before", "1 day before"];

export const STATUSES: EventStatus[] = ["Draft", "Scheduled", "Active", "Ended"];

/* Figma status pill colours (Kanban column headers / calendar badges) */
export const STATUS_STYLE: Record<EventStatus, { pill: string; bar: string }> = {
  Draft: { pill: "bg-[#EDEDF0] text-body", bar: "#FF6720" },
  Scheduled: { pill: "bg-blue/10 text-blue", bar: "#285CE0" },
  Active: { pill: "bg-[#2BCB23]/10 text-[#2BCB23]", bar: "#2BCB23" },
  Ended: { pill: "bg-[#FF6720]/10 text-[#FF6720]", bar: "#667085" },
};

/* Sample events from the Figma "Calendar" / "Kanban Calendar" frames.
 * July 2025 shows exactly the six cards of the Figma month view (same weekday
 * positions); the other Kanban cards sit in June / August so the month stays clean. */
export const INITIAL_EVENTS: CalEvent[] = [
  { id: "e1", title: "Commercial Viability — Lead Review", start: "2025-07-03", end: "2025-07-03", status: "Draft", progress: 42, more: 6 },
  { id: "e2", title: "Storage Technology Review", start: "2025-07-08", end: "2025-07-08", status: "Draft", progress: 42, more: 6 },
  { id: "e3", title: "Regulatory Assessment Draft", start: "2025-07-14", end: "2025-07-15", status: "Active", progress: 42, more: 6 },
  { id: "e4", title: "Partner Evidence Discussion", start: "2025-07-18", end: "2025-07-19", status: "Active", progress: 42, more: 6 },
  { id: "e5", title: "Partner Evidence Discussion", start: "2025-07-24", end: "2025-07-25", status: "Scheduled", progress: 42, more: 6 },
  { id: "e6", title: "Sensor Findings Review", start: "2025-07-28", end: "2025-07-28", status: "Scheduled", progress: 42, more: 6 },
  { id: "e7", title: "Commercial Viability — Lead Assessment", start: "2025-08-05", end: "2025-08-05", status: "Scheduled", progress: 42, more: 6 },
  { id: "e8", title: "Hydrogen Supply Signals Check", start: "2025-08-12", end: "2025-08-12", status: "Scheduled", progress: 42, more: 6 },
  { id: "e9", title: "Cost Model Review", start: "2025-08-20", end: "2025-08-21", status: "Scheduled", progress: 42, more: 6 },
  { id: "e10", title: "Safety Requirements Workshop", start: "2025-08-07", end: "2025-08-07", status: "Scheduled", progress: 42, more: 6 },
  { id: "e11", title: "Baseline Approval Meeting", start: "2025-08-14", end: "2025-08-14", status: "Active", progress: 42, more: 6 },
  { id: "e12", title: "Kick-off: Heat Recovery Pilot", start: "2025-06-24", end: "2025-06-24", status: "Ended", progress: 42, more: 6 },
  { id: "e13", title: "Stakeholder Interviews", start: "2025-06-26", end: "2025-06-27", status: "Ended", progress: 42, more: 6 },
];

/* ---- date helpers (UTC-free, string based) ---- */
export const toDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "15 July 2025" or "15–16 July 2025" */
export function formatRange(start: string, end: string) {
  const a = toDate(start);
  const b = toDate(end);
  if (start === end) return `${a.getDate()} ${MONTHS[a.getMonth()]} ${a.getFullYear()}`;
  if (a.getMonth() === b.getMonth())
    return `${a.getDate()}–${b.getDate()} ${MONTHS[a.getMonth()]} ${a.getFullYear()}`;
  return `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
}

export const monthLabel = (y: number, m: number) => `${MONTHS[m]} ${y}`;
