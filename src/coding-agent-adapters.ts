import type { CodingAgentKind } from "./coding-agents.ts";

export type CodingAgentTransport = "tmux" | "command-file";

export type CodingAgentProduct =
  | "claude"
  | "codex"
  | "opencode"
  | "jcode"
  | "grok"
  | "cursor"
  | "fx"
  | "deepseek"
  | "pi"
  | "copilot";

export type CodingAgentDriver = "sdk" | "rpc" | "cli-tui";

export type CodingAgentCapabilities = {
  interrupt: "immediate" | "queue-only" | "none";
  questions: boolean;
  modelChange: "live" | "restart" | "none";
  thinkingChange: "live" | "restart" | "launch-only" | "none";
  scheduled: boolean;
  toolAccess: "mcp" | "contract-only";
};

export type CodingAgentAdapter = {
  /** Stable product identity. Driver names never cross the public boundary. */
  product: CodingAgentProduct;
  /** Current implementation strategy. Prefer sdk/rpc over terminal drivers. */
  driver: CodingAgentDriver;
  transport: CodingAgentTransport;
  managedLaunch: true;
  /**
   * durable: a dead agent process can be relaunched from persisted history.
   * process-bound: LFG can rediscover the live process after serve restarts,
   * but cannot recreate the provider conversation after that process dies.
   */
  recovery: "durable" | "process-bound";
  capabilities: CodingAgentCapabilities;
  /** A compatibility-only launcher that must not receive new sessions. */
  deprecated?: true;
};

export const CODING_AGENT_ADAPTERS = {
  claude: {
    product: "claude", driver: "cli-tui", transport: "tmux", managedLaunch: true,
    recovery: "durable", deprecated: true,
    capabilities: { interrupt: "immediate", questions: true, modelChange: "live", thinkingChange: "live", scheduled: false, toolAccess: "mcp" },
  },
  codex: {
    product: "codex", driver: "cli-tui", transport: "tmux", managedLaunch: true,
    recovery: "durable", deprecated: true,
    capabilities: { interrupt: "immediate", questions: true, modelChange: "none", thinkingChange: "none", scheduled: false, toolAccess: "mcp" },
  },
  grok: {
    product: "grok", driver: "rpc", transport: "command-file", managedLaunch: true,
    recovery: "durable",
    capabilities: { interrupt: "immediate", questions: true, modelChange: "none", thinkingChange: "launch-only", scheduled: true, toolAccess: "mcp" },
  },
  cursor: {
    product: "cursor", driver: "rpc", transport: "command-file", managedLaunch: true,
    recovery: "durable",
    capabilities: { interrupt: "immediate", questions: true, modelChange: "none", thinkingChange: "launch-only", scheduled: true, toolAccess: "mcp" },
  },
  fx: {
    product: "fx", driver: "rpc", transport: "command-file", managedLaunch: true,
    recovery: "durable",
    // fx exposes reasoning effort only as a stored setting, never on `fx acp`,
    // so LFG cannot pick a thinking level per launch.
    capabilities: { interrupt: "immediate", questions: true, modelChange: "none", thinkingChange: "none", scheduled: true, toolAccess: "mcp" },
  },
  deepseek: {
    product: "deepseek", driver: "rpc", transport: "command-file", managedLaunch: true,
    // The public ACP surface creates fresh sessions only. The live harness is
    // fully interactive, but it cannot reload one after its process exits.
    recovery: "process-bound",
    capabilities: { interrupt: "immediate", questions: false, modelChange: "none", thinkingChange: "none", scheduled: false, toolAccess: "contract-only" },
  },
  copilot: {
    product: "copilot", driver: "sdk", transport: "command-file", managedLaunch: true,
    recovery: "durable",
    capabilities: { interrupt: "immediate", questions: true, modelChange: "live", thinkingChange: "launch-only", scheduled: false, toolAccess: "mcp" },
  },
  aisdk: {
    product: "claude", driver: "sdk", transport: "command-file", managedLaunch: true,
    recovery: "durable",
    capabilities: { interrupt: "immediate", questions: false, modelChange: "none", thinkingChange: "live", scheduled: true, toolAccess: "mcp" },
  },
  "codex-aisdk": {
    product: "codex", driver: "sdk", transport: "command-file", managedLaunch: true,
    recovery: "durable",
    capabilities: { interrupt: "immediate", questions: false, modelChange: "none", thinkingChange: "live", scheduled: true, toolAccess: "mcp" },
  },
  opencode: {
    product: "opencode", driver: "sdk", transport: "command-file", managedLaunch: true,
    recovery: "durable",
    capabilities: { interrupt: "immediate", questions: true, modelChange: "live", thinkingChange: "none", scheduled: true, toolAccess: "mcp" },
  },
  jcode: {
    product: "jcode", driver: "sdk", transport: "command-file", managedLaunch: true,
    recovery: "durable",
    capabilities: { interrupt: "immediate", questions: false, modelChange: "live", thinkingChange: "live", scheduled: false, toolAccess: "mcp" },
  },
  pi: {
    product: "pi", driver: "rpc", transport: "command-file", managedLaunch: true,
    recovery: "durable",
    capabilities: { interrupt: "immediate", questions: false, modelChange: "none", thinkingChange: "live", scheduled: false, toolAccess: "contract-only" },
  },
} as const satisfies Record<Exclude<CodingAgentKind, "hermes">, CodingAgentAdapter>;

/**
 * New sessions use one preferred driver per product. The old `claude` and
 * `codex` request values remain accepted as compatibility aliases, but both now
 * resolve to their SDK drivers. Hermes is deliberately absent: it is historical
 * display data, not an active coding-agent provider.
 */
export const ACTIVE_SESSION_AGENT_KINDS = [
  "aisdk",
  "codex-aisdk",
  "opencode",
  "jcode",
  "grok",
  "cursor",
  "fx",
  "deepseek",
  "pi",
  "copilot",
] as const satisfies readonly CodingAgentKind[];

export type ActiveSessionAgentKind = (typeof ACTIVE_SESSION_AGENT_KINDS)[number];

const ACTIVE_AGENT_SET = new Set<string>(ACTIVE_SESSION_AGENT_KINDS);
const LEGACY_COMMAND_FILE_AGENT_SET = new Set<string>([
  "aisdk",
  "codex-aisdk",
  "opencode",
  "pi",
]);

export function resolveActiveSessionAgent(agent: string | null | undefined): ActiveSessionAgentKind | null {
  if (!agent) return "aisdk";
  if (agent === "claude") return "aisdk";
  if (agent === "codex") return "codex-aisdk";
  return ACTIVE_AGENT_SET.has(agent) ? agent as ActiveSessionAgentKind : null;
}

export const SESSION_AGENT_KINDS = [
  "claude",
  "aisdk",
  "codex",
  "codex-aisdk",
  "opencode",
  "jcode",
  "grok",
  "cursor",
  "fx",
  "deepseek",
  "pi",
  "copilot",
] as const satisfies readonly CodingAgentKind[];

export const TMUX_AGENT_KINDS = [
  "claude",
  "codex",
] as const satisfies readonly CodingAgentKind[];

export const COMMAND_FILE_AGENT_KINDS = [
  "aisdk",
  "codex-aisdk",
  "opencode",
  "pi",
  "grok",
  "cursor",
  "fx",
  "deepseek",
  "copilot",
  "jcode",
] as const satisfies readonly CodingAgentKind[];

export const DURABLE_RECOVERY_AGENT_KINDS = SESSION_AGENT_KINDS.filter(
  (agent) => CODING_AGENT_ADAPTERS[agent].recovery === "durable",
);

export function isCommandFileAgent(agent: string | null | undefined): agent is (typeof COMMAND_FILE_AGENT_KINDS)[number] {
  return !!agent && COMMAND_FILE_AGENT_KINDS.includes(agent as (typeof COMMAND_FILE_AGENT_KINDS)[number]);
}

/** Resolve persisted rows without reclassifying pre-migration terminal sessions. */
export function usesCommandFileRuntime(
  agent: string | null | undefined,
  runtime?: CodingAgentTransport | null,
): boolean {
  if (runtime) return runtime === "command-file";
  return !!agent && LEGACY_COMMAND_FILE_AGENT_SET.has(agent);
}

export function isTmuxAgent(agent: string | null | undefined): agent is (typeof TMUX_AGENT_KINDS)[number] {
  return !!agent && TMUX_AGENT_KINDS.includes(agent as (typeof TMUX_AGENT_KINDS)[number]);
}
