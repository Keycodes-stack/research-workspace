import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(),  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }));

vi.mock("@/lib/api", () => ({
  api: {
    projects: vi.fn(async () => []),
    tasks: vi.fn(async () => []),
    projectIntake: vi.fn(),
    projectInsights: vi.fn(),
    createProjectComplete: vi.fn(),
    people: vi.fn(async () => []),
    createPerson: vi.fn(),
  },
  getToken: () => "t", setToken: () => {}, consumeTokenFragment: () => {}, ApiError: class extends Error {},
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(),  usePathname: () => "/projects/new", useRouter: () => ({ push: () => {} }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("next/image", () => ({ default: ({ alt }: { alt: string }) => <img alt={alt} /> }));

import V2Frame from "@/components/v2/V2Frame";
import NewProjectFlow from "@/components/v2/projects/NewProjectFlow";
import { api } from "@/lib/api";
import { asInsights, type ProjectInsights } from "@/lib/projectIntake";

const insights: ProjectInsights = {
  summary: "Heat recovery looks technically viable.", recommendation: "Run a single-site pilot first.",
  feasibility: 72, stats: [{ label: "Feasibility Score", value: "72%" }],
  risks: [{ risk: "Supplier delay", likelihood: "High", impact: "Medium", mitigation: "Dual source", owner: "Ops" }],
  questions: ["What is the payback at Plant A?"], nextSteps: ["Survey Plant A heat streams"],
  model: "model-a", generatedAt: "2026-11-22T00:00:00Z",
};

const renderFlow = () => render(<V2Frame><NewProjectFlow /></V2Frame>);

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("assessment guard", () => {
  it("accepts a well-formed assessment and rejects anything else", () => {
    expect(asInsights(insights)).toMatchObject({ feasibility: 72, summary: insights.summary });
    expect(asInsights(undefined)).toBeNull();
    expect(asInsights({ summary: "x" })).toBeNull();
    expect(asInsights("text")).toBeNull();
  });
});

describe("AI-assisted project creation", () => {
  it("hides dictation where the browser has no speech recognition", async () => {
    renderFlow();
    await screen.findByLabelText("Project idea");
    expect(screen.queryByRole("button", { name: "Speak your idea" })).toBeNull();
    expect(screen.getByText(/PDFs and images are added to the project/)).toBeInTheDocument();
  });
});
