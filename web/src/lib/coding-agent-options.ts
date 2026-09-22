export type AgentKind =
  | "claude"
  | "aisdk"
  | "codex"
  | "codex-aisdk"
  | "opencode"
  | "omg"
  | "jcode"
  | "grok"
  | "cursor"
  | "fx"
  | "muse"
  | "deepseek"
  | "devin"
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
  { key: "omg", label: "omg agent", scheduled: true },
  { key: "opencode", label: "opencode", scheduled: true },
  { key: "fx", label: "fx", scheduled: true },
  { key: "muse", label: "muse", scheduled: true },
  { key: "deepseek", label: "deepseek" },
  { key: "devin", label: "devin" },
  { key: "jcode", label: "jcode" },
  { key: "pi", label: "pi" },
  { key: "copilot", label: "copilot" },
];

const AGENT_KEYS = new Set<AgentKind>(AGENT_CATALOG.map((entry) => entry.key));

/**
 * The catalog key this value names, or null when it names none.
 *
 * Separate from resolveInitialAgent so a caller can try several saved sources
 * in order (this browser, then the box's cross-device memory, then the box
 * default) without each miss collapsing into the final fallback.
 */
export function knownAgentKind(value: string | null | undefined): AgentKind | null {
  return value && AGENT_KEYS.has(value as AgentKind) ? (value as AgentKind) : null;
}

/**
 * Use a saved agent when it is valid. Otherwise, use the default selected by
 * the host. This keeps the host default in one place for every launch path.
 */
export function resolveInitialAgent(
  savedAgent: string | null,
  defaultAgent: AgentKind,
): AgentKind {
  return knownAgentKind(savedAgent) ?? defaultAgent;
}

/** The catalog subset a scheduled auto agent can actually run. */
export function scheduledAgentOptions(): AgentCatalogEntry[] {
  return AGENT_CATALOG.filter((option) => option.scheduled);
}

/**
 * The agents a picker keeps ON SCREEN even when this box can't launch them —
 * greyed out, as an invitation to connect one rather than a working choice.
 *
 * The picker used to show only what was launchable, which on a fresh hosted
 * Computer is a single icon: OpenCode. That is an honest list and a terrible
 * one. Someone who has Claude Code and Codex accounts sitting right there had
 * no way to learn from this screen that the product takes them — the feature
 * was invisible precisely to the people most ready to use it.
 *
 * It is the FIRST FIVE of the catalog, by construction rather than by a second
 * hand-kept list, so the strip stays a phone-friendly width and the order here
 * can never disagree with the order everywhere else. Agents further down
 * (jcode, pi, copilot) still appear the moment they are actually connected —
 * this list only governs what is advertised BEFORE that.
 */
export const DISCOVERABLE_AGENT_COUNT = 5;

export function discoverableAgentKeys(): AgentKind[] {
  return AGENT_CATALOG.slice(0, DISCOVERABLE_AGENT_COUNT).map((entry) => entry.key);
}

export type CodingAgentAvailability = {
  key: string;
  visible: boolean;
  status: { configured: boolean; accountConnected?: boolean };
};

/**
 * How strictly a surface narrows the roster.
 *
 * "configured": anything this box has installed and switched on.
 * "connected-or-hosted": a hosted/embedded surface, where the runtime's own
 * proxy keys are not user-owned access. An agent has to carry a real account,
 * with two exemptions that need no credential of their own: the omg managed
 * agent, which the hosted Computer provides, and OpenCode, whose free Zen
 * tier runs with no key at all. OpenCode still has to be switched on first —
 * it is opt-in now (see codingAgentVisible), so this exemption only reaches
 * someone who asked for it.
 */
export type AgentAccessMode = "configured" | "connected-or-hosted";

/** Agents a hosted surface may offer without a user-owned account. */
const HOSTED_CREDENTIAL_FREE = new Set<string>(["omg", "opencode"]);

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

/**
 * Which agent a picker should be on, given what it can launch right now.
 * Returns null to mean "leave the selection alone".
 *
 * This used to be inline in the composer as "not launchable -> take the first
 * option", and it is the reason a hosted Computer kept landing people on an
 * agent they never picked. The roster is not a stable fact: it is empty before
 * bootstrap, it changes while a CLI installs, and an agent can read as
 * not-connected for a moment on a cold load. Every one of those windows looked
 * identical to "your agent is gone", so the pick was replaced — and the
 * replacement was then saved over the original at launch, making one bad read
 * permanent on that device.
 *
 * Three rules, in order:
 * 1. An empty roster means NOT LOADED, never "nothing is available".
 * 2. What the person actually chose wins the moment it can run, so a transient
 *    gap heals itself instead of costing them the choice.
 * 3. A substitution prefers the box default over the head of the list, which
 *    is an ordering accident rather than anybody's decision.
 */
export function reconcileSelectedAgent(
  options: readonly { key: string }[],
  selected: string,
  desired: string,
  fallback: string,
): string | null {
  if (!options.length) return null;
  const launchable = (key: string) => !!key && options.some((option) => option.key === key);
  if (launchable(desired)) return desired === selected ? null : desired;
  if (launchable(selected)) return null;
  const next = launchable(fallback) ? fallback : options[0]?.key;
  return next && next !== selected ? next : null;
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
  // proxy keys are not user-owned access, so only the credential-free agents
  // are safe to advertise until account state arrives. That used to be
  // OpenCode alone, which is how a hosted box with a saved omg selection got
  // snapped onto OpenCode and its deepseek default on every cold load.
  if (codingAgents === undefined) {
    return accessMode === "connected-or-hosted"
      ? options.filter((option) => HOSTED_CREDENTIAL_FREE.has(option.key))
      : [...options];
  }
  const available = new Set(
    codingAgents
      .filter(
        (agent) =>
          agent.visible &&
          agent.status.configured &&
          (accessMode === "configured" ||
            HOSTED_CREDENTIAL_FREE.has(agent.key) ||
            agent.status.accountConnected === true),
      )
      .map((agent) => agent.key),
  );
  return options.filter((option) => available.has(option.key));
}

/**
 * The complement of configuredAgentOptions over the discoverable five: the
 * agents to show greyed out because this box cannot launch them yet.
 *
 * Two things it deliberately does NOT do:
 *
 * - It does not re-offer an agent the person turned OFF in Settings. Hiding a
 *   ready agent is an explicit choice; answering it by putting the icon back
 *   as a permanent advertisement would be ignoring them. An unready agent
 *   that is off by default is not a hide — it still belongs in this strip.
 * - It does not advertise anything until the roster has actually ARRIVED.
 *   An empty list is this app's real "not loaded yet" — App seeds the state
 *   with `[]` and never passes undefined, and a genuinely loaded response
 *   always names every agent the box knows about. Treating `[]` as "nothing is
 *   connected" would paint all five as locked for the moment before bootstrap
 *   lands, on every single load, and would leave a signed-out demo surface
 *   (whose transport answers passive reads with empty collections by design)
 *   permanently showing five agents it cannot connect. The strip is empty in
 *   that window today, so nothing is lost by staying empty.
 */
export function lockedAgentOptions<T extends { key: string }>(
  options: readonly T[],
  codingAgents?: readonly CodingAgentAvailability[],
  accessMode: AgentAccessMode = "configured",
): T[] {
  if (!codingAgents?.length) return [];
  const discoverable = new Set<string>(discoverableAgentKeys());
  const launchable = new Set(
    configuredAgentOptions(options, codingAgents, accessMode).map((option) => option.key),
  );
  const hidden = new Set(
    codingAgents
      .filter((agent) => !agent.visible && agent.status.configured)
      .map((agent) => agent.key),
  );
  return options.filter(
    (option) =>
      discoverable.has(option.key) && !launchable.has(option.key) && !hidden.has(option.key),
  );
}
