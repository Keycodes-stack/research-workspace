/* Initial document + comments from the Figma frame "Projects - Workspace" */

export type Reply = { id: string; author: string; avatar: string; time: string; body: string };

export type Comment = {
  id: string;
  author: string;
  avatar: string;
  time: string;
  quote: string;
  body: string;
  replies: Reply[];
  resolved: boolean;
};

export const INITIAL_DOC = `
<h1>Storage Technologies</h1>
<p data-subtitle="true">Working research · Technical Feasibility Assessment · Ibrahim Ghatila and contributors</p>
<h2>Research Objective</h2>
<p>Evaluate technical feasibility, operating requirements, safety and commercial suitability of hydrogen storage alternatives.</p>
<h2>1. Background</h2>
<p>Hydrogen storage technologies vary in maturity, efficiency, operating conditions and infrastructure requirements. This research compares available methods against industrial deployment needs.</p>
<h2>2. Technical Assessment</h2>
<p>Initial research considers compressed gas, liquefied hydrogen and material-based storage approaches. <span data-comment-id="c2">Each has different technical and operational constraints.</span> <span data-comment-id="c1">Comparative evidence remains under review.</span></p>
<h2>3. Open Questions</h2>
<p>What are the comparative lifecycle costs?<br>Which alternatives meet the relevant safety requirements?<br>What infrastructure would each approach require?</p>
`;

export const INITIAL_COMMENTS: Comment[] = [
  {
    id: "c1",
    author: "Ibrahim Ghatila",
    avatar: "/images/avatar-ibrahim.png",
    time: "Today, 10.30 AM",
    quote: "Comparative evidence remains under review.",
    body: "Can we add a comparison of operating pressures and energy requirements?",
    replies: [],
    resolved: false,
  },
  {
    id: "c2",
    author: "Omar Patel",
    avatar: "/images/avatar-omar.png",
    time: "Today, 10.30 AM",
    quote: "Each has different technical and operational constraints.",
    body: "We should validate the cost assumptions against another source.",
    replies: [],
    resolved: false,
  },
];

export const CURRENT_USER = {
  name: "Ibrahim Ghatila",
  avatar: "/images/avatar-ibrahim.png",
};
