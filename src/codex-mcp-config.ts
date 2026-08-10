// Per-launch codex `--config` overrides that name the calling OMG session.
//
// Codex sanitizes the environment of the MCP servers it spawns: the session
// harness has OMG_SESSION_ID, the `omg mcp` child it launches does not, so
// every session-scoped tool falls back to "no caller". `~/.codex/config.toml`
// can't carry the id — one config serves every session — so it rides the
// per-launch config override instead.
//
// The trap this module exists to close: a config override for a server that
// config.toml does not define is not a no-op, it is FATAL. Codex merges the
// override into `mcp_servers`, finds a table with neither `command` nor `url`,
// and refuses to load the config at all:
//
//     Error loading config.toml: invalid transport
//     in `mcp_servers.lfg`
//
// That is a whole-launch failure, not a degraded MCP connection. The launcher
// used to hardcode the server name `lfg`; the server was renamed to `omg`, and
// every codex turn on a machine whose config.toml had been renamed died before
// the model ran. So: discover the name from the config we are overriding, and
// attach env ONLY to a server that is already defined there.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Mirrors the codex-sdk's own config value type (the SDK is imported dynamically). */
export type CodexConfigValue =
  | string
  | number
  | boolean
  | CodexConfigValue[]
  | { [key: string]: CodexConfigValue };

export function codexConfigPath(): string {
  const home = process.env.CODEX_HOME?.trim();
  return home ? join(home, "config.toml") : join(process.env.HOME ?? homedir(), ".codex", "config.toml");
}

function readCodexConfig(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = Bun.TOML.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    // A config.toml we can't parse is codex's problem to report, not ours to
    // compound with a bogus override.
    return null;
  }
}

/**
 * Names of the stdio MCP servers in `config` that are this project's own.
 *
 * Only stdio entries qualify: `env` is meaningless for an HTTP server, and
 * adding it to a `url` entry is another way to write an invalid transport.
 */
export function omgStdioServerNames(config: Record<string, unknown> | null | undefined): string[] {
  const servers = config?.mcp_servers;
  if (!servers || typeof servers !== "object") return [];
  const names: string[] = [];
  for (const [name, raw] of Object.entries(servers as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    // A `url` entry is an HTTP transport; `command` is stdio. Anything with
    // neither is already broken and we must not make it look repairable.
    if (typeof entry.command !== "string" || !entry.command) continue;
    if (typeof entry.url === "string" && entry.url) continue;
    const args = Array.isArray(entry.args) ? entry.args.filter((a): a is string => typeof a === "string") : [];
    const launches = `${entry.command} ${args.join(" ")}`.toLowerCase();
    const isOurs =
      name === "omg" || name === "lfg" || (args.includes("mcp") && /(^|[^a-z])(omg|lfg)([^a-z]|$)/.test(launches));
    if (isOurs) names.push(name);
  }
  return names;
}

/**
 * Codex thread options that tell our MCP server which session is calling.
 *
 * Returns `{}` — never a partial server table — when there is no session id or
 * no server of ours to attach it to. A missing session id degrades tools to
 * "no caller"; a fabricated server entry kills the launch outright.
 */
export function codexOmgMcpConfig(
  sessionId: string | undefined = process.env.OMG_SESSION_ID ?? process.env.LFG_SESSION_ID,
  config: Record<string, unknown> | null = readCodexConfig(codexConfigPath()),
): { config?: { [key: string]: CodexConfigValue } } {
  const sid = sessionId?.trim();
  if (!sid) return {};
  const names = omgStdioServerNames(config);
  if (names.length === 0) return {};
  const mcp_servers: { [key: string]: CodexConfigValue } = {};
  for (const name of names) {
    // Both prefixes: a server binary from before the rename reads only LFG_.
    mcp_servers[name] = { env: { OMG_SESSION_ID: sid, LFG_SESSION_ID: sid } };
  }
  return { config: { mcp_servers } };
}
