// The omg.dev MCP registration for one managed OpenCode session.
//
// OpenCode used to get its omg tools only from a box-global stdio entry in
// ~/.config/opencode/opencode.json (`omg` -> `bun src/cli.ts mcp`). That entry
// had three faults, and the first one shipped a customer session with no omg
// tools at all:
//
//   1. OpenCode connects MCP servers in the background and DROPS one that does
//      not answer in time ("Operation timed out after 30000ms"). The turn then
//      runs with only the built-in tools and nothing tells the model or the
//      user. A cold `bun src/cli.ts mcp` on a hosted Computer is exactly the
//      process that can miss that window. The agent then looked for
//      `omg_build_android` as a shell command and gave up.
//   2. The stdio child names its caller from an inherited environment variable,
//      not the `/mcp?session=` URL and `x-omg-session-token` header that the
//      shared endpoint verifies. So it skips the per-session token and the role
//      filter (src/policy/caller.ts, src/policy/mcp-filter.ts) that every other
//      backend goes through.
//   3. One global file serves every session, so it cannot carry a session id.
//
// The fix is the same registration every other backend already uses
// (omgMcpServers in src/config.ts), handed to this OpenCode server only, as
// `remote` servers on the shared `omg serve` endpoint. The SDK passes
// createOpencodeServer({ config }) to `opencode serve` as
// OPENCODE_CONFIG_CONTENT, which OpenCode merges over the global config, so the
// per-session `omg` entry replaces a stale global stdio `omg` entry for this
// session. There is no separate process to cold-start.
//
// awaitOpencodeMcp then confirms the servers connected before the first prompt
// runs, and reports any that did not, so a failure is visible instead of silent.
import { omgMcpServers } from "../../config.ts";

/**
 * The server a session must have before its first turn: the `omg` key that
 * omgMcpServers registers. The connectors and computer servers are optional.
 */
export const OMG_MCP_SERVER = "omg";

export type OpencodeRemoteMcp = {
  type: "remote";
  url: string;
  headers: Record<string, string>;
  enabled: true;
  /** Our endpoint is not an OAuth server. Do not let OpenCode probe for one. */
  oauth: false;
  /** Tool listing timeout in ms. OpenCode's default is 5000. */
  timeout: number;
};

/** Generous for the local loopback endpoint, which normally answers in < 1 s. */
const TOOL_LIST_TIMEOUT_MS = 15_000;

/**
 * The calling omg.dev session for this harness: the id the spawner exported
 * (src/tmux.ts spawnManagedHarness sets LFG_SESSION_ID), else the harness key,
 * which is the session id for every managed OpenCode launch.
 */
export function opencodeCallerSessionId(
  key: string,
  env: Record<string, string | undefined> = process.env,
): string {
  return env.OMG_SESSION_ID?.trim() || env.LFG_SESSION_ID?.trim() || key;
}

/**
 * OpenCode config that registers this session's omg.dev MCP servers. Pass the
 * result to createOpencodeServer({ config }).
 */
export function opencodeSessionMcpConfig(sessionId: string): { mcp: Record<string, OpencodeRemoteMcp> } {
  const { mcpServers } = omgMcpServers(sessionId);
  const mcp: Record<string, OpencodeRemoteMcp> = {};
  for (const [name, server] of Object.entries(mcpServers ?? {})) {
    mcp[name] = {
      type: "remote",
      url: server.url,
      headers: server.headers,
      enabled: true,
      oauth: false,
      timeout: TOOL_LIST_TIMEOUT_MS,
    };
  }
  return { mcp };
}

type McpStatus = { status?: string; error?: string };

/** The subset of the OpenCode SDK client this needs. Tests pass a fake. */
export type OpencodeMcpClient = {
  mcp: {
    status(options: { query: { directory: string } }): Promise<{ data?: unknown; error?: unknown }>;
    connect(options: { path: { name: string }; query: { directory: string } }): Promise<unknown>;
  };
};

export type McpGateResult = {
  /** Servers that are connected. */
  connected: string[];
  /** Servers that are not connected, with the last error OpenCode reported. */
  missing: Array<{ name: string; status: string; error?: string }>;
};

/**
 * Wait until each named MCP server is connected, retrying a failed one, for at
 * most `timeoutMs`. Never throws: the caller decides how to report `missing`.
 */
export async function awaitOpencodeMcp(
  client: OpencodeMcpClient,
  directory: string,
  names: string[],
  opts: { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<McpGateResult> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const intervalMs = opts.intervalMs ?? 500;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + timeoutMs;
  let statuses: Record<string, McpStatus> = {};
  for (;;) {
    try {
      const res = await client.mcp.status({ query: { directory } });
      if (res.data && typeof res.data === "object") statuses = res.data as Record<string, McpStatus>;
    } catch {}
    const pending = names.filter((name) => statuses[name]?.status !== "connected");
    if (!pending.length || Date.now() >= deadline) break;
    // A server OpenCode gave up on stays down until asked again. Pending
    // (still connecting) and absent servers just need more time.
    for (const name of pending) {
      const status = statuses[name]?.status;
      if (status === "failed" || status === "disabled") {
        try {
          await client.mcp.connect({ path: { name }, query: { directory } });
        } catch {}
      }
    }
    await sleep(intervalMs);
  }
  const connected = names.filter((name) => statuses[name]?.status === "connected");
  const missing = names
    .filter((name) => statuses[name]?.status !== "connected")
    .map((name) => ({
      name,
      status: statuses[name]?.status ?? "absent",
      ...(statuses[name]?.error ? { error: statuses[name]!.error } : {}),
    }));
  return { connected, missing };
}
