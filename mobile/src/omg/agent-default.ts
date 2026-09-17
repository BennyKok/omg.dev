/**
 * Which agent the composer starts on when nobody has chosen.
 *
 * Pure on purpose: session-options.ts pulls in React Native through the
 * provider, and this rule has to be checkable under bun without a device.
 */

/** The slice of a roster row this rule reads. Structural, so provider.tsx's CodingAgent fits. */
export type AgentCandidate = {
  key: string;
  status?: { configured?: boolean; accountConnected?: boolean };
};

/**
 * The order a box tries agents in when a session names none, mirrored from
 * lfg's pickDefaultSessionAgent: Claude and Codex first because a signed-in
 * account is the strongest signal of intent, then the omg agent (the hosted
 * built-in), then OpenCode, whose free models need no account at all.
 */
const AGENT_PREFERENCE = ["aisdk", "codex-aisdk", "omg", "opencode"] as const;

/**
 * `agents[0]` was the roster's own order, which put OpenCode ahead of omg on
 * every hosted Computer: the picker showed the free Zen model while a session
 * sent with no agent ran on omg. A connected agent wins over one that is
 * merely configured, so the composer and the box agree on the same first
 * choice. Anything outside the preference list is still offered, last.
 */
export function preferredAgent(agents: readonly AgentCandidate[]): string | undefined {
  if (agents.length === 0) return undefined;
  const find = (key: string, connected: boolean) =>
    agents.find((a) => a.key === key && (!connected || a.status?.accountConnected === true));
  const connected = AGENT_PREFERENCE.map((key) => find(key, true)).find(Boolean);
  if (connected) return connected.key;
  const configured = AGENT_PREFERENCE.map((key) => find(key, false)).find(Boolean);
  return (configured ?? agents[0]).key;
}
