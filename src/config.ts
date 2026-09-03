import { join, dirname, resolve } from "node:path";
// Cyclic on purpose: session-token reads PATHS from here, and this module only
// calls sessionToken() at launch time, never during module evaluation.
import { SESSION_TOKEN_HEADER, sessionToken } from "./policy/session-token.ts";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export type RuntimePathEnvironment = Record<string, string | undefined>;

export function runtimeDataDir(
  root: string = ROOT,
  env: RuntimePathEnvironment = process.env,
): string {
  const configured = env.OMG_DATA_DIR?.trim() || env.LFG_DATA_DIR?.trim();
  return resolve(configured || join(root, "data"));
}

export function runtimeEnvFile(
  root: string = ROOT,
  env: RuntimePathEnvironment = process.env,
): string {
  const configured = env.OMG_ENV_FILE?.trim() || env.LFG_ENV_FILE?.trim();
  return resolve(configured || join(root, ".env"));
}

const DATA_DIR = runtimeDataDir();

export const PATHS = {
  root: ROOT,
  data: DATA_DIR,
  env: runtimeEnvFile(),
  codexSessions: join(process.env.HOME ?? homedir(), ".codex", "sessions"),
  sessionTitles: join(DATA_DIR, "session-titles.json"),
  installInfo: join(DATA_DIR, "install.json"),
};

/** Persistent root for omg.dev-managed session worktrees. */
export const WORKTREE_ROOT = resolve(
  process.env.LFG_WORKTREE_ROOT ?? `${homedir()}/lfg-worktrees`,
);

// LFG_HOST is the server's BIND address, but the in-box clients — `lfg mcp`,
// `lfg subagent`, `lfg connect` — read the same variable to DIAL that server.
// A bind address is not always dialable: every containerized deploy sets
// LFG_HOST to a wildcard (`0.0.0.0`, or `::` where the platform's private
// network is IPv6-only). `http://0.0.0.0:8766` only connects by accident on
// Linux, and `http://:::8766` does not parse as a URL at all. Fold wildcards
// back to loopback and bracket bare IPv6 literals, so the result is always
// safe to interpolate into a URL authority.
export function localServeHost(raw: string | undefined = process.env.LFG_HOST): string {
  const host = raw?.trim();
  if (!host || host === "0.0.0.0") return "127.0.0.1";
  if (host === "::" || host === "[::]") return "[::1]";
  if (host.startsWith("[")) return host;
  // A bare IPv6 literal has at least two colons. One colon means `host:port`,
  // which this variable is not meant to carry — leave it alone rather than
  // bracketing it into something even more wrong.
  return host.split(":").length > 2 ? `[${host}]` : host;
}

// Absolute URL of the local `lfg serve`, for CLI subcommands that talk to it.
export function localServeBaseUrl(): string {
  if (process.env.LFG_BASE) return process.env.LFG_BASE.replace(/\/$/, "");
  const port = process.env.LFG_PORT || process.env.PORT || "8766";
  return `http://${localServeHost()}:${port}`;
}

/**
 * The OMG MCP registration for one specific session, for the Claude Agent SDK's
 * `mcpServers` option.
 *
 * MCP is served by the shared `omg serve` process rather than a child of each
 * agent (see src/mcp-http.ts), so the endpoint cannot read the caller's identity
 * out of its own environment the way a stdio child could — the caller has to
 * name itself in the URL. A user-scope registration can't: one config file
 * serves every session on the box. So each session re-registers the same
 * endpoint under its own `?session=` URL at launch.
 *
 * The key is the tool namespace the agent sees (`mcp__omg__omg_ship`). It was
 * `lfg` before the rename; sessions already running keep whatever they
 * registered with, and their `lfg_*` calls are aliased at the wire in mcp.ts.
 *
 * Returns nothing outside a managed session, leaving the user-scope
 * registration in charge.
 */
export type OmgMcpServerConfig = { type: "http"; url: string; headers: Record<string, string> };

export function omgMcpServers(
  sessionId?: string,
): { mcpServers?: Record<string, OmgMcpServerConfig> } {
  const sid = (sessionId ?? process.env.OMG_SESSION_ID ?? process.env.LFG_SESSION_ID)?.trim();
  if (!sid) return {};
  const session = `?session=${encodeURIComponent(sid)}`;
  const url = `${localServeBaseUrl()}/mcp${session}`;
  // The token that lets this session claim its own id at the endpoint. See
  // src/policy/session-token.ts for why it is derived rather than stored.
  const headers = { [SESSION_TOKEN_HEADER]: sessionToken(sid) };
  const mcpServers: Record<string, OmgMcpServerConfig> = { omg: { type: "http", url, headers } };
  if (executorMcpAdvertised) {
    mcpServers[EXECUTOR_MCP_SERVER_NAME] = { type: "http", url: executorMcpHttpUrl(sid), headers };
  }
  // The native connector surface, always offered: its tool set is the session
  // member's connectors, which may be empty, and that is a valid empty list.
  mcpServers[CONNECTORS_MCP_SERVER_NAME] = {
    type: "http",
    url: `${localServeBaseUrl()}/mcp/connectors${session}`,
    headers,
  };
  return { mcpServers };
}

/** The tool namespace agents see for native connectors (`mcp__connectors__*`). */
export const CONNECTORS_MCP_SERVER_NAME = "connectors";

/** The tool namespace agents see for the connector gateway (`mcp__executor__*`). */
export const EXECUTOR_MCP_SERVER_NAME = "executor";

/** The omg-served connector endpoint. Session-less for a user-scope registration. */
export function executorMcpHttpUrl(sessionId?: string): string {
  const base = `${localServeBaseUrl()}/mcp/executor`;
  return sessionId ? `${base}?session=${encodeURIComponent(sessionId)}` : base;
}

// Whether sessions launched from this process are handed the connector
// endpoint. Owned by src/executor/daemon.ts: set once the daemon answers, and
// cleared when it stops, so no session is registered against a dead URL. A
// plain flag rather than a settings read because this function runs on every
// launch and must stay synchronous and dependency-free.
let executorMcpAdvertised = false;

export function setExecutorMcpAdvertised(advertised: boolean): void {
  executorMcpAdvertised = advertised;
}

function readVersionFromDisk(): string {
  try {
    const parsed = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof parsed.version === "string" && parsed.version.trim()
      ? parsed.version.trim()
      : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * The version of the code this process is RUNNING — resolved once, at module
 * load, deliberately.
 *
 * Reading package.json per call reports whatever is on disk right now, which is
 * a different fact and a misleading one: a server that has not restarted since a
 * `git pull` / `omg update` advertises a version it is not executing. That is
 * exactly the signal people reach for to confirm a deploy landed, so it fails in
 * the worst possible direction. Observed on this fleet: /api/bootstrap reported
 * 0.1.365 while serving code from 36 minutes before that version existed, and
 * two shipped fixes read as deployed when neither was.
 *
 * Binding it at module scope ties it to process start. A lazy `if (!cached)`
 * memo would look equivalent and reintroduce the same bug in miniature — the
 * first call could land after a pull and cache the new version while running the
 * old code. One readFileSync at import is not worth optimising.
 *
 * If something ever genuinely needs the on-disk value (an "update staged,
 * restart to apply" affordance), add a separately named stagedVersion() rather
 * than making this one ambiguous again.
 */
const RUNNING_VERSION = readVersionFromDisk();

export function appVersion(): string {
  return RUNNING_VERSION;
}

/**
 * The version sitting on DISK right now, which is NOT necessarily the one this
 * process is executing. This is the affordance the note above anticipated.
 *
 * The two differ for a real and common window: an update writes new files and
 * the running server keeps serving the old ones until it restarts. Anything
 * answering "what am I running" must use appVersion(); this exists only so a
 * caller can detect that window and say "staged, restart to apply".
 *
 * Never use this to report a running version. That is the bug appVersion() was
 * introduced to end, and reintroducing it here under a clearer name would be
 * the same bug with better manners.
 */
export function stagedVersion(): string {
  return readVersionFromDisk();
}

export type InstallChannel = "source" | "release" | "container" | "unknown";

export type InstallInfo = {
  channel: InstallChannel;
  repoSlug?: string;
  release?: string;
  releaseAsset?: string;
  installedAt?: string;
  source?: "env" | "file" | "git" | "fallback";
  updateCommand: string;
};

function updateCommand(channel: InstallChannel): string {
  if (channel === "source") return "git pull --ff-only && bun install && (cd web && bun install && bun run build)";
  if (channel === "container") return "redeploy the container to rebuild the image from the current source";
  if (channel === "release") return "lfg setup";
  return "check the install method, then update from the latest GitHub release or source checkout";
}

function cleanChannel(raw: string | undefined): InstallChannel | null {
  if (raw === "source" || raw === "release" || raw === "container") return raw;
  return null;
}

export function installInfo(): InstallInfo {
  const envChannel = cleanChannel(process.env.LFG_INSTALL_CHANNEL);
  if (envChannel) {
    return {
      channel: envChannel,
      repoSlug: process.env.LFG_REPO_SLUG,
      release: process.env.LFG_RELEASE,
      releaseAsset: process.env.LFG_RELEASE_ASSET,
      source: "env",
      updateCommand: updateCommand(envChannel),
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(PATHS.installInfo, "utf8")) as Partial<InstallInfo>;
    const channel = cleanChannel(parsed.channel);
    if (channel) {
      return {
        ...parsed,
        channel,
        source: "file",
        updateCommand: updateCommand(channel),
      };
    }
  } catch {}

  if (existsSync(join(ROOT, ".git"))) {
    return {
      channel: "source",
      source: "git",
      updateCommand: updateCommand("source"),
    };
  }

  return {
    channel: "unknown",
    source: "fallback",
    updateCommand: updateCommand("unknown"),
  };
}
