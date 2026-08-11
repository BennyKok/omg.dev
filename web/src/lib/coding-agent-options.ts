export type AgentKind =
  | "claude"
  | "aisdk"
  | "codex"
  | "codex-aisdk"
  | "opencode"
  | "jcode"
  | "grok"
  | "cursor"
  | "pi"
  | "copilot";

export type AgentCatalogEntry = {
  key: AgentKind;
  label: string;
  /** Can a *scheduled* auto agent run this backend? See the note below. */
  scheduled?: boolean;
};

/**
 * THE agent catalog — every picker in the app reads this one list, in this one
 * order, so a new agent shows up everywhere at once.
 *
 * There used to be a second hardcoded list for the auto-agent sheets. It
 * drifted, and the finding sheet ended up silently offering a smaller roster
 * than the composer sitting right next to it — even though graduating a finding
 * starts an ordinary session that can run any of these.
 *
 * `scheduled` marks the agents a cron'd auto agent can run: those are driven
 * headless by src/auto/runner.ts, which needs a one-shot `pipeTo*` backend. pi
 * and copilot are interactive-only, so they can be launched as sessions but not
 * put on a schedule. That is a real capability difference, expressed as a flag
 * on the shared catalog rather than as a duplicate list that can rot.
 */
export const AGENT_CATALOG: readonly AgentCatalogEntry[] = [
  { key: "aisdk", label: "claude", scheduled: true },
  { key: "codex-aisdk", label: "codex", scheduled: true },
  { key: "grok", label: "grok", scheduled: true },
  { key: "cursor", label: "cursor", scheduled: true },
  { key: "opencode", label: "opencode", scheduled: true },
  { key: "jcode", label: "jcode" },
  { key: "pi", label: "pi" },
  { key: "copilot", label: "copilot" },
];

/** The catalog subset a scheduled auto agent can actually run. */
export function scheduledAgentOptions(): AgentCatalogEntry[] {
  return AGENT_CATALOG.filter((option) => option.scheduled);
}

export type CodingAgentAvailability = {
  key: string;
  visible: boolean;
  status: { configured: boolean; accountConnected?: boolean };
};

export type AgentAccessMode = "configured" | "connected-or-opencode";

/**
 * Resolve the agent icon/label while the configured roster is still loading.
 *
 * The selected agent state is authoritative even before bootstrap supplies the
 * launchable subset. Falling back to the first catalog entry in that window
 * briefly painted Claude for a saved OpenCode selection.
 */
export function displayedAgentOption<T extends { key: string; selectorId?: string }>(
  catalog: readonly T[],
  visible: readonly T[],
  agent: string,
  selectedId: string,
): T | undefined {
  return (
    visible.find((option) => (option.selectorId ?? option.key) === selectedId) ??
    visible.find((option) => option.key === agent) ??
    visible[0] ??
    catalog.find((option) => option.key === agent) ??
    catalog[0]
  );
}

/** Keep agent pickers limited to choices that can actually launch. */
export function configuredAgentOptions<
  T extends { key: string },
>(
  options: readonly T[],
  codingAgents?: readonly CodingAgentAvailability[],
  accessMode: AgentAccessMode = "configured",
): T[] {
  // Before bootstrap has returned, preserve the existing choices to avoid a
  // loading-state flash. Hosted surfaces are the exception: their runtime
  // proxy keys are not user-owned access, so only the anonymous OpenCode path
  // is safe to advertise until account state arrives.
  if (codingAgents === undefined) {
    return accessMode === "connected-or-opencode"
      ? options.filter((option) => option.key === "opencode")
      : [...options];
  }
  const available = new Set(
    codingAgents
      .filter(
        (agent) =>
          agent.visible &&
          agent.status.configured &&
          (accessMode === "configured" ||
            agent.key === "opencode" ||
            agent.status.accountConnected === true),
      )
      .map((agent) => agent.key),
  );
  return options.filter((option) => available.has(option.key));
}
