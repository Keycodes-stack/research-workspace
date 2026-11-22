/* Sample content for the Figma frames "Departments & Workstreams", "Project Baseline & Approvals",
 * "Project Teams" and "Project Chats". */

import type { DetailItem } from "@/components/v2/projects/DetailRows";

/* ---------------- Departments & Workstreams ---------------- */

export const WORKSTREAM_MATRIX: DetailItem[] = [
  { title: "Research: Evidence & Study Plan", detail: "R&D owns the evidence base and the study plan · Lead: Sarah Chen · Due 28 Nov 2026." },
  { title: "Commercial: Market Plan", detail: "Commercial & Marketing sizes demand and pricing · Lead: Omar Patel · Due 5 Dec 2026." },
  { title: "HR: Staffing And Capability", detail: "HR confirms who staffs each workstream and flags skill gaps · Lead: Ayesha Tariq." },
];

export const HANDOFFS: DetailItem[] = [
  { title: "Required Input/Required Output", detail: "Each workstream lists what it needs from others and what it hands over, with a format and owner." },
  { title: "Dependency Owner And Due Date", detail: "Every cross-team dependency has one accountable owner and an agreed due date." },
  { title: "Unstaffed Department Warning", detail: "Finance has no assigned team yet – the department lead has been asked to staff it." },
];

export type InitiativeState = "Assigned" | "Needs review" | "Active" | "Blocked";

export const INITIATIVES: { record: string; details: string; state: InitiativeState }[] = [
  { record: "Department → Assigned Team → Team Members", details: "Department assigned team → team members", state: "Assigned" },
  { record: "Cross-Functional Contributors Linked By Responsibility", details: "Department lead confirms participating team", state: "Needs review" },
  { record: "Cross-Functional Contributors Linked By Responsibility", details: "Cross-functional contributors linked by responsibility", state: "Active" },
  { record: "Research: Evidence & Study Plan", details: "Research: evidence & study plan", state: "Blocked" },
  { record: "Finance: Assumptions", details: "Finance: assumptions/forecast", state: "Assigned" },
  { record: "Commercial: Market Plan", details: "Commercial: market plan", state: "Needs review" },
];

/** Figma state pills */
export const STATE_STYLE: Record<InitiativeState, string> = {
  Assigned: "bg-[#2054FF]/10 text-[#2054FF]",
  "Needs review": "bg-[#FFF6DD] text-[#E3A008]",
  Active: "bg-[#2BCB23]/10 text-[#2BCB23]",
  Blocked: "bg-[#FF2020]/10 text-[#FF6720]",
};

/* ---------------- Project Baseline & Approvals ---------------- */

export const BASELINE_SUMMARY: DetailItem[] = [
  { title: "Financial plan — baseline and scenarios", detail: "Baseline budget USD 1.2M with low / expected / high scenarios, approved 12 Nov 2026." },
  { title: "Financial and delivery risk assessment", detail: "7 risks recorded, 2 rated high: supplier lead time and heat-exchanger efficiency." },
  { title: "Commercial Viability", detail: "Payback of 3.4 years in the expected case; break-even within the pilot horizon." },
];

export type ReviewItem = { id: string; title: string };

export const REVIEW_ITEMS: ReviewItem[] = [
  {
    id: "r1",
    title: "Baseline budget and scenario assumptions are ready for sign-off.",
  },
  {
    id: "r2",
    title: "Delivery plan and decision gates match the approved charter.",
  },
  {
    id: "r3",
    title: "Risk register reviewed by the quality lead.",
  },
];

/* ---------------- Project Teams ---------------- */

export type Member = { name: string; designation: string; department: string; updated: string; email: string; avatar?: string };

export const TEAM_MEMBERS: Member[] = [
  { name: "Alina Khan", designation: "Senior UX Designer", department: "Product Design", updated: "15 Nov 2026", email: "alina@artifexlabs.com" },
  { name: "Omar Patel", designation: "Engineering Manager", department: "Engineering", updated: "15 Nov 2026", email: "omar@artifexlabs.com", avatar: "/images/avatar-omar.png" },
  { name: "Sarah Chen", designation: "Research Scientist", department: "Research", updated: "14 Nov 2026", email: "sarah@artifexlabs.com" },
  { name: "Chelsea Lee", designation: "Commercial Analyst", department: "Commercial", updated: "14 Nov 2026", email: "chelsea@artifexlabs.com", avatar: "/images/avatar-chelsea.png" },
  { name: "Alan Reed", designation: "Quality Lead", department: "Quality", updated: "13 Nov 2026", email: "alan@artifexlabs.com", avatar: "/images/avatar-alan.png" },
  { name: "Ayesha Tariq", designation: "HR Partner", department: "Human Resources", updated: "12 Nov 2026", email: "ayesha@artifexlabs.com" },
  { name: "Hamza Ali", designation: "Finance Controller", department: "Finance", updated: "11 Nov 2026", email: "hamza@artifexlabs.com" },
  { name: "Maria Lopez", designation: "Procurement Lead", department: "Procurement", updated: "10 Nov 2026", email: "maria@artifexlabs.com" },
  { name: "Daniel Kim", designation: "Data Engineer", department: "Digital & IT", updated: "8 Nov 2026", email: "daniel@artifexlabs.com" },
  { name: "Bilal Raza", designation: "Site Engineer", department: "Operations", updated: "6 Nov 2026", email: "bilal@artifexlabs.com" },
];

/* ---------------- Project Chats ---------------- */

export type ChatMessage = {
  id: string;
  author: string;
  avatar?: string;
  text: string;
  /** ISO time */
  at: string;
  files?: string[];
  /** voice notes (data URLs, so they replay after a reload) */
  voices?: { id: string; name: string; src: string; duration: number; mime: string }[];
  mine?: boolean;
};

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

export const initialChats = (): ChatMessage[] => [
  { id: "m1", author: "Omar", avatar: "/images/avatar-omar.png", text: "Site survey is booked for Thursday — I'll share the heat-loss readings after.", at: ago(10) },
  { id: "m2", author: "Chelsea", avatar: "/images/avatar-chelsea.png", text: "Heat recovery — integrated feasibility study · Problem and measurement protocol", at: ago(6) },
  { id: "m3", author: "Chelsea", avatar: "/images/avatar-chelsea.png", text: "Heat recovery — integrated feasibility study · Signal register and assessment", at: ago(5) },
  { id: "m4", author: "Chelsea", avatar: "/images/avatar-chelsea.png", text: "Heat recovery — integrated feasibility study · Financial model and risk notes", at: ago(5) },
  { id: "m5", author: "Omar", avatar: "/images/avatar-omar.png", text: "Thanks — I'll review the protocol today.", at: ago(4) },
  { id: "m6", author: "Chelsea", avatar: "/images/avatar-chelsea.png", text: "Heat recovery — integrated feasibility study · Problem and measurement protocol", at: ago(2) },
  { id: "m7", author: "Ibrahim Ghatila", avatar: "/images/avatar-ibrahim.png", text: "Quality checklist and the supplier datasheet are attached.", at: ago(2), files: ["checklist.png", "datasheet.pdf"], mine: true },
  { id: "m8", author: "Chelsea", avatar: "/images/avatar-chelsea.png", text: "Got it, adding both to the evidence ledger.", at: ago(1) },
];
