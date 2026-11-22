export type Status = "In Progress" | "Pending";
export type Priority = "High" | "Medium" | "Low";

export type Project = {
  slug: string;
  name: string;
  /** title on the overview page: first part blue, last part dark (Figma) */
  title: [string, string];
  code: string;
  lead: string;
  workPackages: number;
  progress: number;
  status: Status;
};

export const PROJECTS: Project[] = [
  {
    slug: "industrial-heat-recovery",
    name: "Industrial Heat Recovery — Sample Pilot",
    title: ["Industrial Heat", "Recovery"],
    code: "P-PILOT",
    lead: "Ibrahim Ghatila",
    workPackages: 6,
    progress: 42,
    status: "In Progress",
  },
  {
    slug: "hydrogen-energy-feasibility",
    name: "Hydrogen Energy Feasibility",
    title: ["Hydrogen Energy", "Feasibility"],
    code: "P-010",
    lead: "Sarah Chen",
    workPackages: 3,
    progress: 42,
    status: "In Progress",
  },
  {
    slug: "industrial-reliability-program",
    name: "Industrial Reliability Program",
    title: ["Industrial Reliability", "Program"],
    code: "P-011",
    lead: "Ibrahim Ghatila",
    workPackages: 2,
    progress: 42,
    status: "In Progress",
  },
  {
    slug: "alternative-fuels-assessment",
    name: "Alternative Fuels Assessment",
    title: ["Alternative Fuels", "Assessment"],
    code: "P-012",
    lead: "Omar Patel",
    workPackages: 1,
    progress: 42,
    status: "Pending",
  },
];

export const getProject = (slug: string) => PROJECTS.find((p) => p.slug === slug);

/** Sample projects, plus projects created in the New Project chat ("new-p<timestamp>").
 *  Those live only in the browser, so the server can't look them up – their pages render
 *  and the client fills in (or reports) the project. */
export const isProjectSlug = (slug: string) => !!getProject(slug) || /^new-p\d+$/.test(slug);

/* Sample content from the Figma "Projects - Hydrogen Energy Feasibility" frame */
export const PANEL_WORK_PACKAGES = [
  "Storage Technology",
  "Commercial Viability",
  "Regulatory Assessment",
];

export const STATS = [
  { value: 6, label: "Work Packages" },
  { value: 3, label: "Sources" },
  { value: 0, label: "Signals" },
  { value: 1, label: "Reviews" },
];

export const UPCOMING: {
  title: string;
  subtitle: string;
  start: string;
  end: string;
  priority: Priority;
}[] = [
  {
    title: "Define The Heat-Loss Baseline",
    subtitle:
      "Heat recovery — integrated feasibility study · Problem and measurement protocol",
    start: "19 Nov",
    end: "21 Nov",
    priority: "High",
  },
  {
    title: "Validate Energy And Supply Signals",
    subtitle:
      "Heat recovery — integrated feasibility study · Signal register and assessment",
    start: "19 Nov",
    end: "21 Nov",
    priority: "Low",
  },
  {
    title: "Test Customer Demand Assumptions",
    subtitle: "Heat recovery — integrated feasibility study · Financial model and risk notes",
    start: "19 Nov",
    end: "21 Nov",
    priority: "High",
  },
  {
    title: "Model Cost And Downside Scenarios",
    subtitle:
      "Heat recovery — integrated feasibility study · Problem and measurement protocol",
    start: "19 Nov",
    end: "21 Nov",
    priority: "Medium",
  },
];

export const WORK_PACKAGES: {
  title: string;
  subtitle: string;
  owner: string;
  team: string;
  status: Status;
}[] = UPCOMING.map((u, i) => ({
  title: u.title,
  subtitle: u.subtitle,
  owner: "Sarah Chen",
  team: "Research & Development",
  status: i === 3 ? "Pending" : "In Progress",
}));
