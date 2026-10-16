import { OMG_DEFAULT_MODEL } from "./omg-models.ts";

// Shared launch policy for the runtime and browser. Explicit model choices win.
// Keep provider aliases where supported; update versioned defaults with the catalog.
export const AGENT_DEFAULT_MODELS = {
  claude: "opus",
  aisdk: "opus",
  codex: "gpt-6.1-sol",
  "codex-aisdk": "gpt-6.1-sol",
  grok: "grok-4.7",
  cursor: "auto",
  fx: "auto",
  muse: "muse-spark-1.2",
  deepseek: "deepseek-v4-flash",
  devin: "adaptive",
  hermes: "nousresearch/hermes-4-405b",
  opencode: "opencode/nemotron-3.5-lightning-free",
  omg: OMG_DEFAULT_MODEL,
  jcode: "auto",
  pi: "sonnet",
  copilot: "claude-sonnet-4.5",
};
