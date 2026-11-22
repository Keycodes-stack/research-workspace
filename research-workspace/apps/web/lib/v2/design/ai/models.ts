/*
 * Models the research panel can show. Gemini (Google AI Studio) and Groq are wired to real
 * API keys on the server; Claude, Perplexity, Llama and Mistral are listed but not connected yet.
 * Shared by the browser (pickers) and the server (API routes) – no secrets here.
 */

export type Provider =
  "gemini" | "groq" | "anthropic" | "perplexity" | "meta" | "mistral";

export type ModelInfo = {
  /** label shown in the UI (also picks the logo) */
  label: string;
  provider: Provider;
  /** model id sent to the provider's API */
  api: string;
  available: boolean;
};

export const MODELS: Record<string, ModelInfo> = {
  "GPT-OSS 120B": {
    label: "GPT-OSS 120B",
    provider: "groq",
    api: "openai/gpt-oss-120b",
    available: true,
  },
  "Qwen 3.8": {
    label: "Qwen 3.8",
    provider: "groq",
    api: "qwen/qwen3.8-27b",
    available: true,
  },
  "Gemini 3.5 Flash Lite": {
    label: "Gemini 3.5 Flash Lite",
    provider: "gemini",
    api: "gemini-3.5-flash-lite",
    available: true,
  },
  "Gemini 3.8 Flash": {
    label: "Gemini 3.8 Flash",
    provider: "gemini",
    api: "gemini-3.8-flash",
    available: true,
  },
  "Perplexity Sonar": {
    label: "Perplexity Sonar",
    provider: "perplexity",
    api: "sonar",
    available: false,
  },
  "Claude Opus": {
    label: "Claude Opus",
    provider: "anthropic",
    api: "claude-opus",
    available: false,
  },
  Llama: { label: "Llama", provider: "meta", api: "llama", available: false },
  Mistral: {
    label: "Mistral",
    provider: "mistral",
    api: "mistral",
    available: false,
  },
};

export type ModelPanel = {
  id: string;
  name: string;
  desc: string;
  /** first model answers; the second checks it and takes over if the first is busy */
  models: string[];
  recommended?: boolean;
  available: boolean;
};

export const MODEL_PANELS: ModelPanel[] = [
  {
    id: "oss-gemini",
    name: "GPT-OSS 120B + Gemini Flash Lite",
    desc: "Fast answers on Groq, Gemini as the second model",
    models: ["GPT-OSS 120B", "Gemini 3.5 Flash Lite"],
    recommended: true,
    available: true,
  },
  {
    id: "gemini-qwen",
    name: "Gemini 3.8 Flash + Qwen 3.8",
    desc: "Google's newest Flash model, Qwen on Groq as backup",
    models: ["Gemini 3.8 Flash", "Qwen 3.8"],
    available: true,
  },
  {
    id: "sonar-opus",
    name: "Perplexity Sonar + Claude Opus",
    desc: "Two models, every claim cross-checked",
    models: ["Perplexity Sonar", "Claude Opus"],
    available: false,
  },
  {
    id: "sonar-llama",
    name: "Perplexity Sonar + Llama (open-weight)",
    desc: "Runs in your own environment",
    models: ["Perplexity Sonar", "Llama"],
    available: false,
  },
  {
    id: "sonar-mistral",
    name: "Perplexity Sonar + Mistral",
    desc: "Open-weight alternative",
    models: ["Perplexity Sonar", "Mistral"],
    available: false,
  },
];

export const DEFAULT_PANEL = MODEL_PANELS[0].id;

/** the panel to use: an unavailable or unknown choice falls back to the default */
export const panelFor = (id: string | undefined) => {
  const p = MODEL_PANELS.find((x) => x.id === id);
  return p && p.available ? p : MODEL_PANELS[0];
};
