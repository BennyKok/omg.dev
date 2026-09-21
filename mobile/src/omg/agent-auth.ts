/**
 * Connect a coding agent's subscription from the phone, on the Computer.
 *
 * The sign-in runs on the box, not through the control plane. The box already
 * exposes it for the web dashboard, and this is the same four calls:
 *
 *   POST   /api/coding-agents/:kind/auth        start `claude auth login` or
 *                                              `codex login --device-auth`
 *   GET    /api/coding-agents/auth/:id          poll the login session
 *   POST   /api/coding-agents/auth/:id/code     Claude: hand over the pasted code
 *   DELETE /api/coding-agents/auth/:id          cancel an abandoned login
 *
 * The CLI on the box writes its own credential there when the login finishes.
 * No token touches the phone and none passes through omg servers; the phone
 * only opens the sign-in page and, for Claude, relays a code.
 */

export type ConnectProvider = "claude" | "codex";

/** Mirrors CodingAgentAuthSession in src/coding-agents.ts. */
export type AgentAuthSession = {
  id: string;
  kind: string;
  provider: string;
  status: "starting" | "waiting" | "complete" | "error";
  authorizationUrl?: string;
  userCode?: string;
  needsCode: boolean;
  error?: string;
  claudeAccountId?: string;
};

export type AgentAuthTransport = {
  request<T>(path: string, init?: RequestInit): Promise<T>;
};

/**
 * Roster key -> which subscription connects it. The cloud Computer reports
 * Claude as `aisdk` and Codex as `codex-aisdk`; a local box reports `claude`
 * and `codex`. Both spellings are the same sign-in, and the box accepts either
 * key on the auth route (authProviderFor in src/coding-agents.ts).
 */
export const CONNECT_PROVIDER: Record<string, ConnectProvider> = {
  claude: "claude",
  aisdk: "claude",
  codex: "codex",
  "codex-aisdk": "codex",
};

export function connectProviderFor(agentKey: string | null | undefined): ConnectProvider | null {
  return agentKey ? CONNECT_PROVIDER[agentKey] ?? null : null;
}

/** The auth-route kind to use when the roster has not told us its own key. */
export const FALLBACK_KIND: Record<ConnectProvider, string> = { claude: "claude", codex: "codex" };

export const PROVIDER_LABEL: Record<ConnectProvider, string> = { claude: "Claude Code", codex: "Codex" };

function json(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export async function startAgentAuth(
  transport: AgentAuthTransport,
  kind: string,
  opts: { claudeAccountId?: string } = {},
): Promise<AgentAuthSession> {
  const body = opts.claudeAccountId ? { claudeAccountId: opts.claudeAccountId } : {};
  return transport.request<AgentAuthSession>(`/api/coding-agents/${encodeURIComponent(kind)}/auth`, json(body));
}

export async function pollAgentAuth(transport: AgentAuthTransport, id: string): Promise<AgentAuthSession> {
  return transport.request<AgentAuthSession>(`/api/coding-agents/auth/${encodeURIComponent(id)}`);
}

export async function submitAgentAuthCode(
  transport: AgentAuthTransport,
  id: string,
  code: string,
): Promise<AgentAuthSession> {
  return transport.request<AgentAuthSession>(
    `/api/coding-agents/auth/${encodeURIComponent(id)}/code`,
    json({ code: code.trim() }),
  );
}

export async function cancelAgentAuth(transport: AgentAuthTransport, id: string): Promise<void> {
  await transport
    .request<unknown>(`/api/coding-agents/auth/${encodeURIComponent(id)}`, { method: "DELETE" })
    .catch(() => {});
}

/** One Claude login on the box. Mirrors ClaudeAccount in src/claude-accounts.ts. */
export type ClaudeAccount = {
  id: string;
  number: number;
  label: string;
  profile?: { label: string; detail?: string };
  connected: boolean;
  needsReconnect?: boolean;
  fromEnv?: boolean;
};

export async function listClaudeAccounts(transport: AgentAuthTransport): Promise<ClaudeAccount[]> {
  const res = await transport.request<{ accounts?: ClaudeAccount[] }>("/api/coding-agents/claude/accounts");
  return res?.accounts ?? [];
}

/**
 * Sign a Claude account out on the box. The box refuses (409) while a session
 * is using the account; the message it sends says so and is shown as is.
 */
export async function removeClaudeAccount(transport: AgentAuthTransport, id: string): Promise<ClaudeAccount[]> {
  const res = await transport.request<{ accounts?: ClaudeAccount[] }>(
    `/api/coding-agents/claude/accounts/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  return res?.accounts ?? [];
}

/**
 * Is this clipboard text plausibly the code Anthropic showed? Claude's manual
 * flow hands back `code#state`, a bare code, or the whole callback URL. A
 * short word or a sentence with spaces is somebody's unrelated clipboard and
 * must not be pasted into the field on their behalf.
 */
export function looksLikeClaudeCode(text: string | null | undefined): boolean {
  const raw = (text ?? "").trim();
  if (!raw || /\s/.test(raw)) return false;
  if (raw.includes("://")) return /[?&]code=/.test(raw);
  if (raw.includes("#")) return raw.split("#")[0]!.length >= 16;
  return raw.length >= 32 && /^[A-Za-z0-9_-]+$/.test(raw);
}

/** Cadence for polling a login session. The web uses 1.5 s; same here. */
export const AUTH_POLL_MS = 1500;
