import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { PATHS, localServeBaseUrl } from "./config.ts";
import { omgCapabilityAccess } from "./omg-capabilities.ts";
import { githubCliPath } from "./tool-connections.ts";
import {
  DEFAULT_CLAUDE_ACCOUNT_ID,
  claudeAccountConfigDir,
  connectedClaudeAccounts,
  listClaudeAccounts,
  type ClaudeAccount,
} from "./claude-accounts.ts";
import {
  hasPiProviderAuth,
  isPiAuthProviderId,
  piAuthProviders,
  piProviderLabel,
  piProviderMethod,
  startPiOAuthLogin,
  type PiAuthProviderId,
} from "./pi-auth.ts";
import { hasOpenCodeAccountAuth, opencodeAuthProviders } from "./opencode-auth.ts";

export type CodingAgentKind =
  | "claude"
  | "aisdk"
  | "codex"
  | "codex-aisdk"
  | "opencode"
  | "jcode"
  | "grok"
  | "cursor"
  | "fx"
  | "hermes"
  | "pi"
  | "copilot";

export type CodingAgentSetting = {
  visible: boolean;
};

export type CodingAgentConfig = {
  agents: Partial<Record<CodingAgentKind, CodingAgentSetting>>;
};

export type CodingAgentCheck = {
  label: string;
  ok: boolean;
  detail?: string;
};

export type CodingAgentStatus = {
  configured: boolean;
  /** True only when the user connected this provider's account. Platform API
   *  keys can make an agent runnable, but they are not a user login. */
  accountConnected: boolean;
  omgCapabilityAccess: "mcp" | "contract-only";
  checks: CodingAgentCheck[];
  instructions: string[];
  canAutoSetup: boolean;
  canLoginInTerminal: boolean;
  setupRunning: boolean;
  setupProgress?: {
    percent: number;
    label: string;
  };
  installCommand?: string;
  loginCommand?: string;
  /** Claude-only: isolated subscription accounts available to session launchers. */
  accounts?: ClaudeAccount[];
  /** pi and opencode: model providers signed into per provider, not per agent. */
  providers?: AgentProviderInfo[];
};

/**
 * One model provider an agent signs into on its own, rather than the agent
 * holding a single account for the whole kind. pi and OpenCode both work this
 * way, and both render through the same row in the settings UI, so the row
 * shape lives here rather than in either credential module.
 */
export type AgentProviderInfo = {
  id: string;
  label: string;
  method: "oauth" | "api-key";
  connected: boolean;
  /** Credential is real but not ours to delete (env var, or a vendor CLI's). */
  fromEnv?: boolean;
  /**
   * Where the credential came from, when "From the environment" would be a lie.
   * `fromEnv` carries two meanings the UI needs to keep apart — "cannot be
   * deleted here" and "was set as an env var" — and only the first is always
   * true of it.
   */
  detail?: string;
};

export type CodingAgentInfo = {
  key: CodingAgentKind;
  label: string;
  visible: boolean;
  status: CodingAgentStatus;
};

/**
 * Providers that can drive a login from the browser instead of a terminal.
 *
 * All but one are a vendor CLI we spawn and scrape. `pi-codex` is the
 * exception: pi ships no login subcommand, so we drive its OAuth in-process
 * through the bundled pi-ai library instead (see pi-auth.ts). The distinction
 * is invisible past this module — both kinds produce the same device-code
 * session the UI renders.
 */
export type AuthProvider =
  | "claude"
  | "codex"
  | "grok"
  | "fx"
  | "github"
  | "pi-anthropic"
  | "pi-codex";

const AUTH_PROVIDER_LABELS: Record<AuthProvider, string> = {
  claude: "Claude",
  codex: "Codex",
  grok: "Grok",
  fx: "Vercel",
  github: "GitHub",
  "pi-anthropic": "Claude",
  "pi-codex": "ChatGPT",
};

/** pi's provider ids are its own; the sign-in UI names them per vendor. */
const PI_AUTH_PROVIDERS: Partial<Record<PiAuthProviderId, AuthProvider>> = {
  anthropic: "pi-anthropic",
  "openai-codex": "pi-codex",
};

export type CodingAgentAuthSession = {
  id: string;
  kind: CodingAgentKind | "github";
  provider: AuthProvider;
  status: "starting" | "waiting" | "complete" | "error";
  authorizationUrl?: string;
  userCode?: string;
  needsCode: boolean;
  error?: string;
  claudeAccountId?: string;
};

type InternalAuthSession = CodingAgentAuthSession & {
  /** Unset for in-process logins (pi), which have no CLI to spawn or scrape. */
  process?: ReturnType<typeof Bun.spawn>;
  /** How to abort this login, whichever kind it is. */
  cancel: () => void;
  /** In-process logins that ask for a pasted code answer it through this. */
  submitCode?: (code: string) => boolean;
  output: string;
  ready: Promise<void>;
  markReady: () => void;
  expiresAt: number;
};

export type SetupCheck = {
  key: string;
  label: string;
  configured: boolean;
  running: boolean;
  checks: CodingAgentCheck[];
  instructions: string[];
  canAutoSetup: boolean;
  actionLabel: string;
};

export const CODING_AGENT_KINDS: Exclude<CodingAgentKind, "claude" | "hermes">[] = [
  "aisdk",
  "codex-aisdk",
  "grok",
  "cursor",
  "fx",
  "opencode",
  "jcode",
  "copilot",
  "pi",
];

export const CODING_AGENT_LABELS: Record<CodingAgentKind, string> = {
  claude: "claude",
  aisdk: "claude",
  codex: "codex",
  "codex-aisdk": "codex",
  opencode: "opencode",
  jcode: "jcode",
  grok: "grok",
  cursor: "cursor",
  fx: "fx",
  hermes: "hermes",
  pi: "pi",
  copilot: "copilot",
};

const configPath = () => join(PATHS.data, "coding-agents.json");
const setupRuns = new Map<CodingAgentKind, Promise<void>>();
const setupProgress = new Map<CodingAgentKind, { percent: number; label: string }>();

export type CodingAgentSetupLog = {
  running: boolean;
  kinds: CodingAgentKind[];
  lines: string[];
  error: string | null;
  finishedAt: number | null;
};
const SETUP_LOG_LINE_LIMIT = 600;
let setupLog: CodingAgentSetupLog = {
  running: false,
  kinds: [],
  lines: [],
  error: null,
  finishedAt: null,
};

export function getCodingAgentSetupLog(): CodingAgentSetupLog {
  return { ...setupLog, kinds: [...setupLog.kinds], lines: [...setupLog.lines] };
}

function appendSetupLog(line: string): void {
  const clean = line.replace(/\x1b\[[0-9;]*m/g, "").replace(/\r/g, "").trimEnd();
  if (!clean.trim()) return;
  setupLog.lines.push(clean);
  if (setupLog.lines.length > SETUP_LOG_LINE_LIMIT) {
    setupLog.lines.splice(0, setupLog.lines.length - SETUP_LOG_LINE_LIMIT);
  }
}
const systemSetupRuns = new Map<string, Promise<void>>();
const authSessions = new Map<string, InternalAuthSession>();
const AUTH_SESSION_TTL_MS = 15 * 60 * 1000;
const AUTH_OUTPUT_LIMIT = 32_000;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function getCodingAgentConfig(): Promise<CodingAgentConfig> {
  const raw = readJson<CodingAgentConfig>(configPath());
  return { agents: raw?.agents ?? {} };
}

export async function setCodingAgentVisibility(
  kind: CodingAgentKind,
  visible: boolean,
): Promise<CodingAgentConfig> {
  const cfg = await getCodingAgentConfig();
  cfg.agents[kind] = { ...(cfg.agents[kind] ?? {}), visible };
  await mkdir(PATHS.data, { recursive: true });
  await Bun.write(configPath(), JSON.stringify(cfg, null, 2));
  return cfg;
}

/**
 * Composer toggle for one coding agent.
 *
 * An agent is ON only when it can actually run. No saved choice follows
 * readiness: ready defaults ON, unready defaults OFF. An explicit hide stays
 * off after the agent becomes ready. An old implicit-on value (`true`, or
 * missing) does not keep an unready agent on.
 */
export function codingAgentVisible(
  saved: boolean | undefined,
  configured: boolean,
): boolean {
  return saved === false ? false : configured;
}

function which(name: string, extra: string[] = []): string | null {
  try {
    const onPath = Bun.which(name);
    if (onPath) return onPath;
  } catch {}
  for (const p of extra) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

function bunPath(): string | null {
  try {
    return Bun.which("bun") ?? process.execPath ?? null;
  } catch {
    return process.execPath ?? null;
  }
}

function userHome(): string {
  return process.env.HOME ?? homedir();
}

function claudePath(): string | null {
  const home = userHome();
  return which("claude", [
    process.env.LFG_CLAUDE_PATH ?? "",
    `${home}/.local/bin/claude`,
    `${home}/.bun/bin/claude`,
    "/usr/local/bin/claude",
  ]);
}

function codexPath(): string | null {
  const home = userHome();
  return which("codex", [
    process.env.LFG_CODEX_PATH ?? "",
    `${home}/.local/bin/codex`,
    `${home}/.bun/bin/codex`,
    "/usr/local/bin/codex",
  ]);
}

function opencodePath(): string | null {
  const home = userHome();
  return which("opencode", [
    process.env.LFG_OPENCODE_PATH ?? "",
    `${home}/.local/bin/opencode`,
    `${home}/.bun/bin/opencode`,
    "/usr/local/bin/opencode",
  ]);
}

function jcodePath(): string | null {
  const home = userHome();
  const override = process.env.LFG_JCODE_PATH?.trim();
  if (override) return existsSync(override) ? override : null;
  return which("jcode", [
    `${home}/.local/bin/jcode`,
    `${home}/.jcode/bin/jcode`,
    "/usr/local/bin/jcode",
  ]);
}

type JcodeAuthStatus = {
  any_available?: unknown;
  providers?: Array<{ id?: unknown; status?: unknown; credential_source?: unknown }>;
};

function jcodeProviderConnected(
  reported: Array<{ id?: unknown; status?: unknown; credential_source?: unknown }>,
  id: "claude" | "openai",
): boolean {
  const aliases = id === "openai" ? ["openai", "codex"] : [id];
  const match = reported.find(
    (provider) => typeof provider.id === "string" && aliases.includes(provider.id),
  );
  return (
    match?.status === "available" &&
    typeof match.credential_source === "string" &&
    match.credential_source !== "none"
  );
}

/** Claude and Codex rows stay visible even when the CLI is missing. */
function jcodeProviderRows(
  reported: Array<{ id?: unknown; status?: unknown; credential_source?: unknown }> = [],
): AgentProviderInfo[] {
  return [
    { id: "claude", label: "Claude", method: "oauth", connected: jcodeProviderConnected(reported, "claude") },
    { id: "openai", label: "Codex", method: "oauth", connected: jcodeProviderConnected(reported, "openai") },
  ];
}

async function jcodeAuthStatus(): Promise<{
  available: boolean;
  accountConnected: boolean;
  providers: Array<{ id?: unknown; status?: unknown; credential_source?: unknown }>;
}> {
  const empty = { available: false, accountConnected: false, providers: [] };
  const binary = jcodePath();
  if (!binary) return empty;
  const out = await commandOutputAsync([binary, "--no-update", "auth", "status", "--json"]);
  if (!out.ok) return empty;
  try {
    const parsed = JSON.parse(out.text) as JcodeAuthStatus;
    const providers = Array.isArray(parsed.providers) ? parsed.providers : [];
    const available = parsed.any_available === true || providers.some((p) => p.status === "available");
    const accountConnected = providers.some(
      (p) =>
        p.status === "available" &&
        typeof p.credential_source === "string" &&
        p.credential_source !== "none",
    );
    return { available, accountConnected, providers };
  } catch {
    return empty;
  }
}

function grokPath(): string | null {
  const home = userHome();
  return which("grok", [
    process.env.LFG_GROK_PATH ?? "",
    `${home}/.local/bin/grok`,
    `${home}/.bun/bin/grok`,
    `${home}/.grok/downloads/grok-linux-x86_64`,
    "/usr/local/bin/grok",
  ]);
}

function isGrokAgentPath(path: string): boolean {
  try {
    const real = realpathSync(path);
    return real.includes("/.grok/") || real.endsWith("/grok-linux-x86_64");
  } catch {
    return path.includes("/.grok/");
  }
}

function cursorPath(): string | null {
  const home = userHome();
  const cursorAgent = rejectGrokAgent(which("cursor-agent", [
    process.env.LFG_CURSOR_PATH ?? "",
    `${home}/.local/bin/cursor-agent`,
    `${home}/.bun/bin/cursor-agent`,
    "/usr/local/bin/cursor-agent",
  ]));
  if (cursorAgent) return cursorAgent;
  return rejectGrokAgent(which("agent", [
    `${home}/.local/bin/agent`,
    `${home}/.bun/bin/agent`,
    "/usr/local/bin/agent",
  ]));
}

// fx's published installer drops a single static binary in FX_INSTALL_DIR,
// defaulting to ~/.local/bin. There is no package manager path to check.
function fxPath(): string | null {
  const home = userHome();
  return which("fx", [
    process.env.LFG_FX_PATH ?? "",
    `${home}/.local/bin/fx`,
    `${home}/.bun/bin/fx`,
    "/usr/local/bin/fx",
  ]);
}

function rejectGrokAgent(path: string | null): string | null {
  if (!path) return null;
  return isGrokAgentPath(path) ? null : path;
}

// pi has no standalone-CLI requirement: the backend drives LFG's own bundled
// copy of @earendil-works/pi-coding-agent over its RPC protocol (see
// agents/backends/pi-session.ts), with LFG_PI_PATH as an explicit override.
// Detection therefore mirrors the harness's resolvePiCliPath() instead of
// scanning PATH for a global binary.
function piPath(): string | null {
  const override = process.env.LFG_PI_PATH;
  if (override && existsSync(override)) return override;
  const bundled = join(PATHS.root, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
  return existsSync(bundled) ? bundled : null;
}

function copilotPath(): string | null {
  const home = userHome();
  return which("copilot", [
    process.env.LFG_COPILOT_PATH ?? "",
    `${home}/.local/bin/copilot`,
    `${home}/.bun/bin/copilot`,
    "/usr/local/bin/copilot",
  ]);
}

async function hasCodexAccountAuth(): Promise<boolean> {
  const home = userHome();
  if (existsSync(`${home}/.codex/auth.json`)) return true;
  const codex = codexPath();
  if (!codex) return false;

  // `codex login status` can treat OPENAI_API_KEY as sufficient runtime auth.
  // Remove the platform key so this check answers the narrower question:
  // did the user connect their ChatGPT account?
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  return (await commandOutputAsync([codex, "login", "status"], env)).ok;
}

function commandOutput(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): { ok: boolean; text: string } {
  try {
    const proc = Bun.spawnSync(argv, {
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const text = `${new TextDecoder().decode(proc.stdout)}${new TextDecoder().decode(proc.stderr)}`;
    return { ok: proc.exitCode === 0, text };
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : String(e) };
  }
}

// Setup-status probes invoke each agent's CLI. Those processes can take more
// than a second apiece to boot; running them with spawnSync freezes Bun's only
// event loop and makes every unrelated API request look offline until all of
// the probes finish. Keep the synchronous helper above for setup mutations,
// where command ordering is intentional, but never use it on the read path.
async function commandOutputAsync(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): Promise<{ ok: boolean; text: string }> {
  try {
    const proc = Bun.spawn(argv, {
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const timeout = setTimeout(() => proc.kill(), 15_000);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { ok: exitCode === 0, text: `${stdout}${stderr}` };
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : String(e) };
  }
}

function mcpCommandArgs(): string[] | null {
  const bun = bunPath();
  if (!bun) return null;
  return [bun, join(PATHS.root, "src", "cli.ts"), "mcp"];
}

/**
 * The shared MCP endpoint on the local `lfg serve`.
 *
 * Registering this URL instead of a stdio command is what stops every agent
 * session from spawning its own `lfg mcp` process (~38 MB each; 14 sessions on
 * one box cost ~540 MB of identical processes). The tool surface is the same —
 * see src/mcp-http.ts.
 */
function mcpHttpUrl(): string {
  return `${localServeBaseUrl()}/mcp`;
}

/**
 * Every Claude config dir a session can run under.
 *
 * `null` means "inherit this process's environment" — the default account,
 * whose user config is `~/.claude.json`. Each *additional* connected account
 * gets its own config dir, and its sessions run with `CLAUDE_CONFIG_DIR`
 * pointed at it (see claudeAccountEnv). The Claude CLI reads user-scope MCP
 * registrations out of `<config dir>/.claude.json`, so a registration written
 * only to the default dir leaves every non-default account's sessions with no
 * LFG tools at all while setup still reports "registered".
 */
export function claudeConfigDirs(
  accounts: Pick<ClaudeAccount, "id">[] = listClaudeAccounts(),
  resolveDir: (id: string) => string | null = claudeAccountConfigDir,
): (string | null)[] {
  const dirs: (string | null)[] = [null];
  for (const account of accounts) {
    if (account.id === DEFAULT_CLAUDE_ACCOUNT_ID) continue;
    const dir = resolveDir(account.id);
    if (dir && !dirs.includes(dir)) dirs.push(dir);
  }
  return dirs;
}

function claudeEnvFor(configDir: string | null): Record<string, string | undefined> {
  return configDir ? { ...process.env, CLAUDE_CONFIG_DIR: configDir } : process.env;
}

// The name each agent CLI files this MCP server under. It is user-visible: it
// becomes the tool namespace an agent sees, e.g. `mcp__omg__omg_ship`.
//
// It was `lfg` before the rename. Registrations are persisted in each CLI's own
// user-scope config, so the old entry survives an upgrade and has to be removed
// explicitly — leaving both would register the same ~30 tools twice under two
// namespaces, in the context window of every session, pointing at one endpoint.
export const MCP_SERVER_NAME = "omg";
export const MCP_SERVER_NAME_LEGACY = "lfg";

async function hasClaudeOmgMcp(): Promise<boolean> {
  const claude = claudePath();
  if (!claude) return false;
  // Registered means registered *everywhere a session can run*: one unregistered
  // account dir is one account whose sessions launch mute.
  const perDir = await Promise.all(claudeConfigDirs().map(async (configDir) => {
    const out = await commandOutputAsync([claude, "mcp", "get", MCP_SERVER_NAME], claudeEnvFor(configDir));
    if (!out.ok) return false;
    // Only the HTTP registration counts. A leftover stdio entry from an older
    // install reports as "not installed" so setup replaces it.
    return out.text.includes(mcpHttpUrl());
  }));
  return perDir.every(Boolean);
}

async function hasCodexOmgMcp(): Promise<boolean> {
  const codex = codexPath();
  const args = mcpCommandArgs();
  if (!codex || !args) return false;
  const out = await commandOutputAsync([codex, "mcp", "get", MCP_SERVER_NAME]);
  if (!out.ok) return false;
  return args.every((part) => out.text.includes(part));
}

async function commandHasOmgMcp(binary: string | null): Promise<boolean> {
  if (!binary) return false;
  const out = await commandOutputAsync([binary, "mcp", "list"]);
  // Only the new name counts as installed, so a box still carrying the old
  // registration is re-run by setup and gets the legacy entry cleaned up.
  return out.ok && new RegExp(`\\b${MCP_SERVER_NAME}\\b`, "i").test(out.text);
}

function hasOpencodeOmgMcp(): Promise<boolean> {
  return commandHasOmgMcp(opencodePath());
}

function hasJcodeOmgMcp(): Promise<boolean> {
  const current = readJson<Record<string, unknown>>(join(userHome(), ".jcode", "mcp.json"));
  const servers = current?.mcpServers;
  if (!servers || typeof servers !== "object") return Promise.resolve(false);
  const entry = (servers as Record<string, unknown>)[MCP_SERVER_NAME];
  const args = mcpCommandArgs();
  if (!entry || typeof entry !== "object" || !args) return Promise.resolve(false);
  const record = entry as { command?: unknown; args?: unknown };
  return Promise.resolve(
    record.command === args[0] &&
      Array.isArray(record.args) &&
      record.args.length === args.length - 1 &&
      record.args.every((part, index) => part === args[index + 1]),
  );
}

function hasGrokOmgMcp(): Promise<boolean> {
  return commandHasOmgMcp(grokPath());
}

function hasCursorOmgMcp(): Promise<boolean> {
  return commandHasOmgMcp(cursorPath());
}

// `grok login` writes ~/.grok/auth.json as a map of issuer::client-id -> entry,
// and only a non-empty `key` proves a completed sign-in. The directory itself is
// created by any grok invocation, so its existence is not evidence of auth.
function hasGrokAccountAuth(): boolean {
  try {
    const raw = readFileSync(join(userHome(), ".grok", "auth.json"), "utf8");
    const root = JSON.parse(raw) as Record<string, { key?: unknown } | null>;
    if (!root || typeof root !== "object") return false;
    return Object.values(root).some(
      (entry) => !!entry && typeof entry.key === "string" && entry.key.length > 0,
    );
  } catch {
    return false;
  }
}

function hasCursorAuth(): boolean {
  const home = userHome();
  return !!process.env.CURSOR_API_KEY || existsSync(`${home}/.cursor`);
}

// `cursor-agent login` records the signed-in identity in
// ~/.cursor/cli-config.json as `authInfo` (email, userId, authId). The
// directory itself — which hasCursorAuth() accepts, because a box that has ever
// run the CLI is usually a box that signed in — proves nothing about an
// account, and reading it as one is how a genuinely connected Cursor kept
// showing up as "connect me" in the hosted picker: that strip requires
// accountConnected, not configured, so a kind that never sets it is locked
// forever.
function hasCursorAccountAuth(): boolean {
  const info = readJson<{ authInfo?: { userId?: unknown; email?: unknown } }>(
    join(userHome(), ".cursor", "cli-config.json"),
  )?.authInfo;
  if (!info || typeof info !== "object") return false;
  const { userId, email } = info;
  if (typeof userId === "number" && Number.isFinite(userId) && userId > 0) return true;
  if (typeof userId === "string" && userId.length > 0) return true;
  return typeof email === "string" && email.length > 0;
}

// pi's auth is file-based (~/.pi/agent/auth.json) or the ANTHROPIC_API_KEY env
// var. Connecting a provider is now a real sign-in (see pi-auth.ts), and the
// check lives there: the old test here treated the mere existence of auth.json
// as proof, but pi writes that file as `{}` the first time it starts, so every
// box that had ever launched pi reported "Ready" with no credentials at all.
function hasPiAuth(): boolean {
  return hasPiProviderAuth();
}

function hasCopilotAuth(): boolean {
  const home = userHome();
  // Precedence matches Copilot CLI's env resolution: a Copilot-specific token
  // wins over generic GH_TOKEN/GITHUB_TOKEN when both are set.
  if (process.env.COPILOT_GITHUB_TOKEN) return true;
  if (process.env.GH_TOKEN) return true;
  if (process.env.GITHUB_TOKEN) return true;
  return hasCopilotAccountAuth();
}

// Interactive /login writes to ~/.copilot/ (session-state and a token/host
// file). An empty ~/.copilot/ directory - which any stray tool can create - is
// NOT proof of auth, so require an artifact that the login flow itself
// produces. Separate from hasCopilotAuth() because a platform-supplied
// GH_TOKEN makes Copilot runnable without being the user's own connected
// account — the same split every other kind draws.
function hasCopilotAccountAuth(): boolean {
  const home = userHome();
  return (
    existsSync(`${home}/.copilot/hosts.yml`) ||
    existsSync(`${home}/.copilot/config.json`) ||
    existsSync(`${home}/.copilot/session-state`)
  );
}

// fx reaches Vercel AI Gateway three ways, in its own precedence order: a
// Vercel OIDC token, the AI_GATEWAY_API_KEY env var, then a stored credential
// from `fx login` (~/.fx/auth.json) or `fx setup` (~/.fx/api-key).
function hasFxAuth(): boolean {
  if (process.env.AI_GATEWAY_API_KEY) return true;
  if (process.env.VERCEL_OIDC_TOKEN) return true;
  return hasFxAccountAuth();
}

// Only a real sign-in counts as a connected account: a platform-supplied
// gateway key makes fx runnable without being the user's own login. Both files
// are written by the flow itself, so neither appears on a box that merely ran
// fx once.
function hasFxAccountAuth(): boolean {
  const home = userHome();
  return existsSync(`${home}/.fx/auth.json`) || existsSync(`${home}/.fx/api-key`);
}

function installCommandFor(kind: CodingAgentKind): string | null {
  if (kind === "claude" || kind === "aisdk") return "curl -fsSL https://claude.ai/install.sh | bash";
  if (kind === "codex" || kind === "codex-aisdk") return "bun add -g @openai/codex";
  if (kind === "opencode") return "bun add -g opencode-ai";
  if (kind === "jcode") return "curl -fsSL https://jcode.sh/install | bash";
  if (kind === "grok") return "curl -fsSL https://x.ai/cli/install.sh | bash";
  if (kind === "cursor") return "curl -fsSL https://cursor.com/install | bash";
  if (kind === "fx") return "curl -fsSL https://fx.sh/setup.sh | bash";
  if (kind === "copilot") return "npm install -g @github/copilot";
  // pi is no longer bundled. Its provider layer (@earendil-works/pi-ai) pulls
  // in eleven SDKs — Anthropic, OpenAI, Google GenAI, Mistral, Bedrock — which
  // came to 115MB of a 244MB install, for one optional agent among eight.
  // OMG_INSTALL_PI is recorded in .env so updates keep it.
  if (kind === "pi") return "OMG_INSTALL_PI=1 omg setup";
  return null;
}

function loginCommandPartsFor(kind: CodingAgentKind): string[] | null {
  if (kind === "claude" || kind === "aisdk") {
    return [claudePath() ?? "claude", "auth", "login", "--claudeai"];
  }
  if (kind === "codex" || kind === "codex-aisdk") {
    return [codexPath() ?? "codex", "login", "--device-auth"];
  }
  if (kind === "opencode") return [opencodePath() ?? "opencode"];
  if (kind === "jcode") return [jcodePath() ?? "jcode", "login"];
  if (kind === "grok") return [grokPath() ?? "grok", "login", "--device-auth"];
  if (kind === "cursor") return [cursorPath() ?? "cursor-agent", "login"];
  if (kind === "fx") return [fxPath() ?? "fx", "login"];
  if (kind === "copilot") return [copilotPath() ?? "copilot"];
  // pi has no login subcommand — auth is file-based (~/.pi/agent/auth.json) or
  // ANTHROPIC_API_KEY, so there is no terminal login to offer.
  if (kind === "pi") return null;
  return null;
}

function authProviderFor(kind: CodingAgentKind): AuthProvider | null {
  if (kind === "claude" || kind === "aisdk") return "claude";
  if (kind === "codex" || kind === "codex-aisdk") return "codex";
  if (kind === "grok") return "grok";
  if (kind === "fx") return "fx";
  return null;
}

function authProviderBinary(provider: AuthProvider): string | null {
  if (provider === "claude") return claudePath();
  if (provider === "codex") return codexPath();
  if (provider === "grok") return grokPath();
  if (provider === "fx") return fxPath();
  return githubCliPath();
}

function authProviderArgv(provider: AuthProvider, binary: string): string[] {
  if (provider === "claude") return [binary, "auth", "login", "--claudeai"];
  if (provider === "github") {
    return [
      binary,
      "auth",
      "login",
      "--hostname",
      "github.com",
      "--git-protocol",
      "https",
      "--web",
    ];
  }
  // fx has no --device-auth flag because `fx login` IS the device flow: it
  // prints the Vercel verification URL and code, then polls.
  if (provider === "fx") return [binary, "login"];
  // Codex and Grok both expose an RFC 8628 device flow that prints a
  // verification URL plus a short user code — no terminal interaction needed.
  return [binary, "login", "--device-auth"];
}

/** Remove terminal control sequences before parsing or showing CLI output. */
export function cleanAuthOutput(value: string): string {
  return value
    .replace(/\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "");
}

export function parseAuthOutput(
  provider: AuthProvider,
  raw: string,
): Pick<CodingAgentAuthSession, "authorizationUrl" | "userCode" | "needsCode"> {
  const output = cleanAuthOutput(raw);
  const authorizationUrl = output.match(/https:\/\/[^\s\x07\x1b]+/)?.[0];
  if (provider === "grok") {
    // `grok login --device-auth` prints (on stderr):
    //   To sign in, open this URL in your browser:
    //     https://accounts.x.ai/oauth2/device?user_code=4ZCY-6ZPQ
    //   Confirm this code in your browser:
    //     4ZCY-6ZPQ
    // The verification URL already carries the code, so prefer reading it from
    // there and fall back to the printed confirmation code.
    const userCode =
      output.match(/[?&]user_code=([A-Z0-9]{4,}-[A-Z0-9]{4,})/i)?.[1] ??
      output.match(/this code[\s\S]{0,160}?\b([A-Z0-9]{4,}-[A-Z0-9]{4,})\b/i)?.[1];
    return { authorizationUrl, userCode, needsCode: false };
  }
  if (provider === "codex") {
    const userCode = output.match(/one-time code[\s\S]{0,160}?\b([A-Z0-9]{4,}-[A-Z0-9]{4,})\b/i)?.[1];
    return { authorizationUrl, userCode, needsCode: false };
  }
  if (provider === "fx") {
    // `fx login` prints:
    //   Open https://vercel.com/oauth/device?user_code=XFCJ-ZGNJ
    //   Code: XFCJ-ZGNJ
    //
    //   Waiting for authentication...
    // Same shape as grok: the URL already carries the code, so read it there
    // and fall back to the printed "Code:" line.
    const userCode =
      output.match(/[?&]user_code=([A-Z0-9]{4,}-[A-Z0-9]{4,})/i)?.[1] ??
      output.match(/^\s*Code:\s*([A-Z0-9]{4,}-[A-Z0-9]{4,})\s*$/im)?.[1];
    return { authorizationUrl, userCode, needsCode: false };
  }
  if (provider === "github") {
    const userCode = output.match(
      /one-time code[\s\S]{0,160}?\b([A-Z0-9]{4,}-[A-Z0-9]{4,})\b/i,
    )?.[1];
    return { authorizationUrl, userCode, needsCode: false };
  }
  return {
    authorizationUrl,
    needsCode: /paste code here/i.test(output),
  };
}

function publicAuthSession(session: InternalAuthSession): CodingAgentAuthSession {
  const { process: _process, cancel: _cancel, output: _output, ready: _ready, markReady: _markReady, expiresAt: _expiresAt, ...result } = session;
  return result;
}

function stopAuthSession(session: InternalAuthSession): void {
  if (session.status === "starting" || session.status === "waiting") {
    try { session.cancel(); } catch {}
  }
}

function updateAuthSessionFromOutput(session: InternalAuthSession): void {
  const parsed = parseAuthOutput(session.provider, session.output);
  if (parsed.authorizationUrl) session.authorizationUrl = parsed.authorizationUrl;
  if (parsed.userCode) session.userCode = parsed.userCode;
  session.needsCode = parsed.needsCode;
  const ready = !!session.authorizationUrl && (session.provider === "claude" || !!session.userCode);
  if (ready && session.status === "starting") {
    session.status = "waiting";
    session.markReady();
    // GitHub prints its device code and then pauses at "Press Enter to open".
    // The web UI already opens the URL itself; advancing stdin lets gh move on
    // to polling for the approval instead of leaving a successful browser login
    // stuck behind an invisible terminal prompt.
    if (session.provider === "github") {
      const stdin = session.process?.stdin;
      if (stdin && typeof stdin !== "number") {
        stdin.write("\n");
        void Promise.resolve(stdin.flush()).catch(() => {});
      }
    }
  }
}

async function collectAuthOutput(
  session: InternalAuthSession,
  stream: ReadableStream<Uint8Array> | number | undefined,
): Promise<void> {
  if (!stream || typeof stream === "number") return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      session.output = (session.output + decoder.decode(value, { stream: true })).slice(-AUTH_OUTPUT_LIMIT);
      updateAuthSessionFromOutput(session);
    }
  } catch {}
}

export async function startCodingAgentAuth(
  kind: CodingAgentKind,
  opts: { claudeAccountId?: string; piProvider?: string } = {},
): Promise<CodingAgentAuthSession> {
  if (kind === "pi") {
    const id = opts.piProvider ?? "openai-codex";
    if (!isPiAuthProviderId(id)) throw new Error(`Unknown pi provider ${id}`);
    if (piProviderMethod(id) !== "oauth") {
      throw new Error(`${piProviderLabel(id)} is connected with an API key, not a browser sign-in`);
    }
    return startPiAuthSession(id);
  }
  const provider = authProviderFor(kind);
  if (!provider) throw new Error(`${CODING_AGENT_LABELS[kind]} does not support browser login yet`);
  return startAuthSession(kind, provider, opts);
}

/**
 * Browser sign-in for a pi provider, driven in-process.
 *
 * Same session lifecycle as the CLI-backed providers — the UI polls the same
 * endpoint and cannot tell them apart — but instead of spawning a binary and
 * regexing its stdout we get the device code as a typed callback, and we know
 * the login succeeded because pi-ai hands us the credential rather than because
 * a process exited 0.
 */
async function startPiAuthSession(id: PiAuthProviderId): Promise<CodingAgentAuthSession> {
  const provider = PI_AUTH_PROVIDERS[id];
  if (!provider) throw new Error(`${piProviderLabel(id)} has no browser sign-in`);
  for (const existing of authSessions.values()) {
    if (existing.provider === provider && (existing.status === "starting" || existing.status === "waiting")) {
      stopAuthSession(existing);
      authSessions.delete(existing.id);
    }
  }

  let markReady = () => {};
  const ready = new Promise<void>((resolve) => { markReady = resolve; });
  // The login's cancel handle only exists after the login starts, but the
  // session must exist before it — the notify callback writes into it. Route
  // cancellation through a mutable holder rather than letting either one
  // reference the other before it is initialized.
  let cancelLogin: () => void = () => {};
  const session: InternalAuthSession = {
    id: randomUUID(),
    kind: "pi",
    provider,
    status: "starting",
    needsCode: false,
    cancel: () => cancelLogin(),
    output: "",
    ready,
    markReady,
    expiresAt: Date.now() + AUTH_SESSION_TTL_MS,
  };
  authSessions.set(session.id, session);

  const login = startPiOAuthLogin(id, (event) => {
    if (event.type === "device_code") {
      session.userCode = event.userCode;
      session.authorizationUrl = event.verificationUri;
    } else if (event.type === "auth_url") {
      session.authorizationUrl = event.url;
    } else if (event.type === "needs_code") {
      session.needsCode = true;
    }
    if (session.authorizationUrl && session.status === "starting") {
      session.status = "waiting";
      session.markReady();
    }
  });
  cancelLogin = login.cancel;
  session.submitCode = login.submitCode;

  void login.done.then(
    () => {
      session.status = "complete";
      session.markReady();
    },
    (e: unknown) => {
      if (session.status === "complete") return;
      session.status = "error";
      session.error = e instanceof Error ? e.message : `${piProviderLabel(id)} sign-in failed`;
      session.markReady();
    },
  );
  setTimeout(() => {
    if (!authSessions.has(session.id)) return;
    if (session.status === "starting" || session.status === "waiting") {
      session.status = "error";
      session.error = "Login expired. Start again for a new code.";
      stopAuthSession(session);
      session.markReady();
    }
  }, AUTH_SESSION_TTL_MS);

  await Promise.race([
    session.ready,
    new Promise<void>((resolve) => setTimeout(resolve, 15_000)),
  ]);
  if (session.status === "starting") {
    stopAuthSession(session);
    session.status = "error";
    session.error = session.error ?? "The login page could not be prepared. Please try again.";
  }
  return publicAuthSession(session);
}

/** Tool connections share the same device-login session owner as coding
 * agents. That keeps popup handling, polling, expiry, and cancellation on one
 * path while exposing a truthful tool-specific endpoint to the UI. */
export async function startToolAuth(kind: "github"): Promise<CodingAgentAuthSession> {
  return startAuthSession(kind, "github");
}

async function startAuthSession(
  kind: CodingAgentKind | "github",
  provider: AuthProvider,
  opts: { claudeAccountId?: string } = {},
): Promise<CodingAgentAuthSession> {
  const binary = authProviderBinary(provider);
  if (!binary) throw new Error(`Install ${AUTH_PROVIDER_LABELS[provider]} before signing in`);
  const claudeConfigDir =
    provider === "claude" && opts.claudeAccountId
      ? claudeAccountConfigDir(opts.claudeAccountId)
      : undefined;
  if (provider === "claude" && opts.claudeAccountId && !claudeConfigDir) {
    throw new Error("Claude account not found");
  }

  for (const existing of authSessions.values()) {
    if (existing.provider === provider && (existing.status === "starting" || existing.status === "waiting")) {
      stopAuthSession(existing);
      authSessions.delete(existing.id);
    }
  }

  const argv = authProviderArgv(provider, binary);
  const proc = Bun.spawn(argv, {
    cwd: userHome(),
    env: {
      ...process.env,
      BROWSER: "true",
      ...(claudeConfigDir ? { CLAUDE_CONFIG_DIR: claudeConfigDir } : {}),
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  let markReady = () => {};
  const ready = new Promise<void>((resolve) => { markReady = resolve; });
  const session: InternalAuthSession = {
    id: randomUUID(),
    kind,
    provider,
    status: "starting",
    needsCode: false,
    process: proc,
    cancel: () => proc.kill(),
    output: "",
    ready,
    markReady,
    expiresAt: Date.now() + AUTH_SESSION_TTL_MS,
    ...(provider === "claude" && opts.claudeAccountId
      ? { claudeAccountId: opts.claudeAccountId }
      : {}),
  };
  authSessions.set(session.id, session);
  void collectAuthOutput(session, proc.stdout);
  void collectAuthOutput(session, proc.stderr);
  void proc.exited.then((exitCode) => {
    if (session.status === "error") return;
    if (exitCode === 0) {
      session.status = "complete";
    } else if (session.status !== "complete") {
      const output = cleanAuthOutput(session.output).trim().split("\n").slice(-3).join(" ");
      session.status = "error";
      session.error = output || `${AUTH_PROVIDER_LABELS[provider]} login was cancelled`;
    }
    session.markReady();
  });
  setTimeout(() => {
    if (!authSessions.has(session.id)) return;
    if (session.status === "starting" || session.status === "waiting") {
      session.status = "error";
      session.error = "Login expired. Start again for a new code.";
      stopAuthSession(session);
      session.markReady();
    }
  }, AUTH_SESSION_TTL_MS);

  await Promise.race([
    session.ready,
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (session.status === "starting" && !session.authorizationUrl) {
    stopAuthSession(session);
    session.status = "error";
    session.error = "The login page could not be prepared. Please try again.";
  }
  return publicAuthSession(session);
}

export function getCodingAgentAuth(id: string): CodingAgentAuthSession | null {
  const session = authSessions.get(id);
  if (!session) return null;
  if (Date.now() > session.expiresAt && session.status !== "complete") {
    session.status = "error";
    session.error = "Login expired. Start again for a new code.";
    stopAuthSession(session);
  }
  return publicAuthSession(session);
}

export async function submitCodingAgentAuthCode(id: string, code: string): Promise<CodingAgentAuthSession> {
  const session = authSessions.get(id);
  if (!session) throw new Error("Login session not found. Start again.");
  if (!session.needsCode) throw new Error("This login does not accept a code");
  if (session.status !== "waiting") throw new Error("This login is no longer waiting for a code");
  const value = code.trim();
  if (!value) throw new Error("Enter the code from Claude");
  // In-process logins (pi) resolve the prompt directly; CLI-backed ones have
  // to have it typed at the stdin of the process still waiting on it.
  if (session.submitCode) {
    if (!session.submitCode(value)) throw new Error("This login is no longer waiting for a code");
    session.needsCode = false;
    return publicAuthSession(session);
  }
  if (session.provider !== "claude") throw new Error("This login does not accept a code");
  const stdin = session.process?.stdin;
  if (!stdin || typeof stdin === "number") throw new Error("Claude login is no longer accepting a code");
  session.needsCode = false;
  stdin.write(`${value}\n`);
  await stdin.flush();
  return publicAuthSession(session);
}

export function cancelCodingAgentAuth(id: string): void {
  const session = authSessions.get(id);
  if (!session) return;
  stopAuthSession(session);
  authSessions.delete(id);
}

/**
 * Is this login still one a person could come back and finish?
 *
 * Pure, and exported, so the rule can be tested without spawning a real CLI
 * login. "complete" and "error" are over; an expired one is an abandoned tab,
 * not work.
 */
export function isLoginPending(
  session: { status: string; expiresAt: number },
  now: number,
): boolean {
  if (session.status !== "starting" && session.status !== "waiting") return false;
  return now <= session.expiresAt;
}

/**
 * How many browser logins are still live and waiting for the user right now.
 *
 * WHY THIS EXISTS. A login is real work, but until now it was invisible from
 * outside this process. The host asks this box "are you busy?" every ~45s and
 * reads only agent sessions, so a box with a half-finished Claude login
 * truthfully answered "no" and was hibernated mid-login. A paying customer hit
 * exactly that on 2026-08-17: he clicked Login, his machine slept underneath
 * him, and he never ran an agent at all.
 *
 * This REPORTS, it does not decide. The host owns the idle policy — how long a
 * machine is held, and whether a pending login extends that — because a number
 * baked into this process could never be tuned for boxes already in the field.
 * All this box owes the host is the truth about what it is doing.
 *
 * Bounded regardless: AUTH_SESSION_TTL_MS already ends an abandoned login, so
 * this cannot report "busy" forever even if a host chose to trust it forever.
 *
 * Counted, not a boolean, so a host can say "2 logins waiting" rather than just
 * "busy", and so one stuck login is distinguishable from several.
 */
export function pendingCodingAgentLogins(now: number = Date.now()): number {
  let count = 0;
  for (const session of authSessions.values()) {
    if (isLoginPending(session, now)) count += 1;
  }
  return count;
}

export function loginCommandFor(kind: CodingAgentKind): string | null {
  const parts = loginCommandPartsFor(kind);
  return parts ? parts.map(shellQuote).join(" ") : null;
}

async function statusFor(kind: CodingAgentKind): Promise<CodingAgentStatus> {
  const checks: CodingAgentCheck[] = [];
  const instructions: string[] = [];
  let canAutoSetup = true;
  let canLoginInTerminal = true;
  let accountConnected = false;
  let jcodeProviders: AgentProviderInfo[] | undefined;

  const addBinary = (label: string, path: string | null) => {
    checks.push({ label, ok: !!path, detail: path ?? "not found" });
  };
  const addAuth = (label: string, ok: boolean, detail: string) => {
    checks.push({ label, ok, detail });
  };

  if (kind === "claude" || kind === "aisdk") {
    accountConnected = connectedClaudeAccounts().length > 0;
    addBinary("Claude CLI", claudePath());
    addAuth(
      "Claude auth",
      accountConnected || !!process.env.ANTHROPIC_API_KEY,
      "use Login below or set ANTHROPIC_API_KEY",
    );
    instructions.push("Add Claude accounts below, or set ANTHROPIC_API_KEY.");
  } else if (kind === "codex" || kind === "codex-aisdk") {
    accountConnected = await hasCodexAccountAuth();
    addBinary("Codex CLI", codexPath());
    addAuth(
      "Codex auth",
      accountConnected || !!process.env.OPENAI_API_KEY,
      "use Login below or set OPENAI_API_KEY",
    );
    instructions.push("Use Login to connect ChatGPT in your browser, or set OPENAI_API_KEY.");
  } else if (kind === "opencode") {
    // Auth is deliberately not a `checks` row: OpenCode Zen's free tier needs no
    // credential, so an unauthenticated install is still fully usable and must
    // stay `configured` — it is what a hosted box offers before any sign-in.
    // It does decide which models the picker may honestly offer, though.
    accountConnected = hasOpenCodeAccountAuth();
    addBinary("OpenCode CLI", opencodePath());
    // Go and Zen both authenticate with a pasted key, so they connect from the
    // provider rows above. `opencode auth login` is still the way in for the
    // OAuth providers (ChatGPT), which is why the command is still mentioned.
    instructions.push(
      "Connect OpenCode Go or Zen with an API key above. The free Zen models work with no key at all, and `opencode auth login` adds OAuth providers such as ChatGPT.",
    );
  } else if (kind === "jcode") {
    const auth = await jcodeAuthStatus();
    jcodeProviders = jcodeProviderRows(auth.providers);
    accountConnected =
      auth.accountConnected || jcodeProviders.some((provider) => provider.connected);
    addBinary("Jcode CLI", jcodePath());
    addAuth("Jcode provider", auth.available || accountConnected, "connect Claude or Codex");
    // Sign-in is the Claude/Codex rows. A leftover Login button would be a
    // second product next to Connect.
    canLoginInTerminal = false;
  } else if (kind === "cursor") {
    accountConnected = hasCursorAccountAuth();
    addBinary("Cursor CLI", cursorPath());
    addAuth("Cursor auth", hasCursorAuth(), "run `cursor-agent login` once or set CURSOR_API_KEY");
    instructions.push("Install Cursor CLI, then run `cursor-agent login` and sign in, or set CURSOR_API_KEY.");
  } else if (kind === "fx") {
    accountConnected = hasFxAccountAuth();
    addBinary("fx CLI", fxPath());
    addAuth("fx auth", hasFxAuth(), "use Login below or set AI_GATEWAY_API_KEY");
    instructions.push("Use Login to sign in to Vercel in your browser, or set AI_GATEWAY_API_KEY.");
  } else if (kind === "pi") {
    const providers = piAuthProviders();
    accountConnected = providers.some((p) => p.connected && !p.fromEnv);
    addBinary("pi runtime", piPath());
    addAuth("pi auth", hasPiAuth(), "connect a provider, or set ANTHROPIC_API_KEY");
    // pi has no `pi login` subcommand, so there is nothing to run in a terminal
    // and no installer to invoke — the runtime ships with LFG. Sign-in happens
    // per provider through the rows above, driven in-process by pi-auth.ts.
    canAutoSetup = false;
    canLoginInTerminal = false;
  } else if (kind === "copilot") {
    accountConnected = hasCopilotAccountAuth();
    addBinary("GitHub Copilot CLI", copilotPath());
    addAuth("Copilot auth", hasCopilotAuth(), "run 'copilot' and /login, or set COPILOT_GITHUB_TOKEN / GH_TOKEN with the Copilot Requests scope");
    instructions.push("Install Copilot CLI (npm install -g @github/copilot; requires Node 22+), then run 'copilot' once and /login, or set COPILOT_GITHUB_TOKEN (or GH_TOKEN) with the Copilot Requests scope.");
  } else {
    accountConnected = hasGrokAccountAuth();
    addBinary("Grok CLI", grokPath());
    addAuth(
      "Grok auth",
      accountConnected || !!process.env.XAI_API_KEY,
      "use Login below or set XAI_API_KEY",
    );
    instructions.push("Use Login to sign in to Grok in your browser, or set XAI_API_KEY.");
  }

  return {
    configured: checks.every((c) => c.ok),
    accountConnected,
    omgCapabilityAccess: omgCapabilityAccess(kind),
    checks,
    instructions,
    canAutoSetup,
    canLoginInTerminal,
    setupRunning: setupRuns.has(kind),
    setupProgress: setupProgress.get(kind),
    installCommand: installCommandFor(kind) ?? undefined,
    loginCommand: loginCommandFor(kind) ?? undefined,
    ...(kind === "claude" || kind === "aisdk"
      ? { accounts: listClaudeAccounts() }
      : {}),
    ...(kind === "pi" ? { providers: piAuthProviders() } : {}),
    ...(kind === "opencode" ? { providers: opencodeAuthProviders() } : {}),
    ...(kind === "jcode" ? { providers: jcodeProviders ?? jcodeProviderRows() } : {}),
  };
}

export async function listCodingAgents(): Promise<CodingAgentInfo[]> {
  const cfg = await getCodingAgentConfig();
  // Probe every kind together. The CLI auth checks (jcode, Codex) can take
  // more than a second apiece; serialising them would stall the read even
  // after the spawn itself is async.
  return Promise.all(
    CODING_AGENT_KINDS.map(async (key) => {
      const status = await statusFor(key);
      return {
        key,
        label: CODING_AGENT_LABELS[key],
        visible: codingAgentVisible(cfg.agents[key]?.visible, status.configured),
        status,
      };
    }),
  );
}

export async function listSetupChecks(): Promise<SetupCheck[]> {
  const args = mcpCommandArgs();
  const claude = claudePath();
  const codex = codexPath();
  const opencode = opencodePath();
  const jcode = jcodePath();
  const grok = grokPath();
  const cursor = cursorPath();
  // Launch the slow CLI probes together. More importantly, they yield the Bun
  // event loop while running, so live sockets and ordinary API responses stay
  // responsive even when this cache is cold.
  const [claudeMcp, codexMcp, opencodeMcp, jcodeMcp, grokMcp, cursorMcp] = await Promise.all([
    claude ? hasClaudeOmgMcp() : Promise.resolve(false),
    codex ? hasCodexOmgMcp() : Promise.resolve(false),
    opencode ? hasOpencodeOmgMcp() : Promise.resolve(false),
    jcode ? hasJcodeOmgMcp() : Promise.resolve(false),
    grok ? hasGrokOmgMcp() : Promise.resolve(false),
    cursor ? hasCursorOmgMcp() : Promise.resolve(false),
  ]);
  const checks: CodingAgentCheck[] = [
    { label: "Bun", ok: !!bunPath(), detail: bunPath() ?? "not found" },
    { label: "tmux", ok: !!which("tmux"), detail: which("tmux") ?? "not found" },
    { label: "git", ok: !!which("git"), detail: which("git") ?? "not found" },
    { label: "LFG MCP command", ok: !!args, detail: args?.join(" ") ?? "not available" },
  ];
  if (claude) {
    checks.push({
      label: "Claude MCP",
      ok: claudeMcp,
      detail: claudeMcp ? "registered" : "not registered",
    });
  } else {
    checks.push({ label: "Claude MCP", ok: true, detail: "Claude CLI not installed" });
  }
  if (codex) {
    checks.push({
      label: "Codex MCP",
      ok: codexMcp,
      detail: codexMcp ? "registered" : "not registered",
    });
  } else {
    checks.push({ label: "Codex MCP", ok: true, detail: "Codex CLI not installed" });
  }
  // No row for aisdk/codex-aisdk (they ride the Claude/Codex CLI registrations
  // above) and none for pi: pi is an RPC backend driving LFG's bundled
  // @earendil-works/pi-coding-agent — it has no `pi mcp` registration surface, so
  // there is no LFG MCP to install or check for it.
  const optionalMcpAgents: Array<[string, string | null, boolean]> = [
    ["OpenCode", opencode, opencodeMcp],
    ["Jcode", jcode, jcodeMcp],
    ["Grok", grok, grokMcp],
    ["Cursor", cursor, cursorMcp],
  ];
  for (const [label, binary, ok] of optionalMcpAgents) {
    checks.push(binary
      ? { label: `${label} MCP`, ok, detail: ok ? "registered" : "not registered" }
      : { label: `${label} MCP`, ok: true, detail: `${label} CLI not installed` });
  }
  return [
    {
      key: "lfg-mcp",
      label: "LFG MCP",
      configured: checks.every((check) => check.ok),
      running: systemSetupRuns.has("lfg-mcp"),
      checks,
      instructions: [
        "Registers the local LFG MCP server with Claude, Codex, OpenCode, Jcode, Grok, and Cursor when those CLIs are installed.",
      ],
      canAutoSetup: !!args && !!(claude || codex || opencode || jcode || grok || cursor),
      actionLabel: "Install MCP",
    },
  ];
}

/**
 * Register LFG with Claude over HTTP rather than stdio.
 *
 * `mcp remove` first also migrates an older stdio registration, so an existing
 * install stops spawning a per-session `lfg mcp` child as soon as setup reruns.
 */
async function installClaudeMcp(claude: string): Promise<void> {
  // One remove+add pair per config dir, awaited rather than spawnSync'd: this
  // loop grows with the number of Claude accounts, and each `claude` boot costs
  // about a second — enough to visibly stall every live session if it froze the
  // event loop. Ordering per dir still holds.
  for (const configDir of claudeConfigDirs()) {
    const env = claudeEnvFor(configDir);
    await commandOutputAsync([claude, "mcp", "remove", MCP_SERVER_NAME_LEGACY, "-s", "user"], env);
    await commandOutputAsync([claude, "mcp", "remove", MCP_SERVER_NAME, "-s", "user"], env);
    const out = await commandOutputAsync([
      claude, "mcp", "add", "-s", "user", "--transport", "http", MCP_SERVER_NAME, mcpHttpUrl(),
    ], env);
    if (!out.ok) throw new Error(out.text.trim() || "Claude MCP install failed");
  }
}

/**
 * Seed a freshly created Claude account's config dir with the LFG MCP
 * registration, so its first session has the tool surface instead of waiting
 * for someone to notice and rerun setup. Best effort: a missing Claude CLI or a
 * failed registration must not fail account creation.
 */
export async function registerClaudeMcpForAccount(accountId: string): Promise<boolean> {
  const claude = claudePath();
  const configDir = claudeAccountConfigDir(accountId);
  if (!claude || !configDir) return false;
  const env = claudeEnvFor(configDir);
  await commandOutputAsync([claude, "mcp", "remove", MCP_SERVER_NAME_LEGACY, "-s", "user"], env);
  await commandOutputAsync([claude, "mcp", "remove", MCP_SERVER_NAME, "-s", "user"], env);
  const out = await commandOutputAsync([
    claude, "mcp", "add", "-s", "user", "--transport", "http", MCP_SERVER_NAME, mcpHttpUrl(),
  ], env);
  return out.ok;
}

function installCodexMcp(codex: string, args: string[]): void {
  commandOutput([codex, "mcp", "remove", MCP_SERVER_NAME_LEGACY]);
  commandOutput([codex, "mcp", "remove", MCP_SERVER_NAME]);
  const out = commandOutput([codex, "mcp", "add", MCP_SERVER_NAME, "--", ...args]);
  if (!out.ok) throw new Error(out.text.trim() || "Codex MCP install failed");
}

function mergeJsonConfig(path: string, update: (current: Record<string, unknown>) => Record<string, unknown>): void {
  const parsed = readJson<Record<string, unknown>>(path);
  if (existsSync(path) && !parsed) {
    throw new Error(`Cannot update invalid JSON config: ${path}`);
  }
  const current = parsed ?? {};
  const next = update(current);
  writeFileSync(path, JSON.stringify(next, null, 2));
}

export function withOpencodeOmgMcp(current: Record<string, unknown>, args: string[]): Record<string, unknown> {
  const mcp = typeof current.mcp === "object" && current.mcp !== null
    ? current.mcp as Record<string, unknown>
    : {};
  // Drop the pre-rename entry rather than merging over it: both would resolve to
  // the same server and register its whole toolset twice.
  const { [MCP_SERVER_NAME_LEGACY]: _legacy, ...rest } = mcp;
  return {
    ...current,
    mcp: {
      ...rest,
      [MCP_SERVER_NAME]: { type: "local", command: args, enabled: true },
    },
  };
}

export function withCursorOmgMcp(current: Record<string, unknown>, args: string[]): Record<string, unknown> {
  const mcpServers = typeof current.mcpServers === "object" && current.mcpServers !== null
    ? current.mcpServers as Record<string, unknown>
    : {};
  const { [MCP_SERVER_NAME_LEGACY]: _legacy, ...rest } = mcpServers;
  return {
    ...current,
    mcpServers: {
      ...rest,
      [MCP_SERVER_NAME]: { command: args[0], args: args.slice(1) },
    },
  };
}

export function withJcodeOmgMcp(current: Record<string, unknown>, args: string[]): Record<string, unknown> {
  const mcpServers = typeof current.mcpServers === "object" && current.mcpServers !== null
    ? current.mcpServers as Record<string, unknown>
    : {};
  const { [MCP_SERVER_NAME_LEGACY]: _legacy, ...rest } = mcpServers;
  return {
    ...current,
    mcpServers: {
      ...rest,
      [MCP_SERVER_NAME]: { command: args[0], args: args.slice(1) },
    },
  };
}

async function installOpencodeMcp(args: string[]): Promise<void> {
  const path = join(userHome(), ".config", "opencode", "opencode.json");
  await mkdir(dirname(path), { recursive: true });
  mergeJsonConfig(path, (current) => withOpencodeOmgMcp(current, args));
}

function installGrokMcp(grok: string, args: string[]): void {
  commandOutput([grok, "mcp", "remove", MCP_SERVER_NAME_LEGACY, "--scope", "user"]);
  commandOutput([grok, "mcp", "remove", MCP_SERVER_NAME, "--scope", "user"]);
  const out = commandOutput([grok, "mcp", "add", MCP_SERVER_NAME, "--scope", "user", "--", ...args]);
  if (!out.ok) throw new Error(out.text.trim() || "Grok MCP install failed");
}

async function installCursorMcp(args: string[]): Promise<void> {
  const path = join(userHome(), ".cursor", "mcp.json");
  await mkdir(dirname(path), { recursive: true });
  mergeJsonConfig(path, (current) => withCursorOmgMcp(current, args));
  const cursor = cursorPath();
  if (cursor) commandOutput([cursor, "mcp", "enable", MCP_SERVER_NAME]);
}

async function installJcodeMcp(args: string[]): Promise<void> {
  const path = join(userHome(), ".jcode", "mcp.json");
  await mkdir(dirname(path), { recursive: true });
  mergeJsonConfig(path, (current) => withJcodeOmgMcp(current, args));
}

export async function runSetupAction(key: string): Promise<void> {
  if (key !== "lfg-mcp") throw new Error(`unknown setup action "${key}"`);
  if (systemSetupRuns.has(key)) throw new Error(`${key} setup is already running`);
  const run = (async () => {
    const args = mcpCommandArgs();
    if (!args) throw new Error("Bun is required to register the LFG MCP server");
    const claude = claudePath();
    const codex = codexPath();
    const opencode = opencodePath();
    const jcode = jcodePath();
    const grok = grokPath();
    const cursor = cursorPath();
    if (!claude && !codex && !opencode && !jcode && !grok && !cursor) {
      throw new Error("Install a supported coding agent first, then register the LFG MCP server");
    }
    if (claude) await installClaudeMcp(claude);
    if (codex) installCodexMcp(codex, args);
    if (opencode) await installOpencodeMcp(args);
    if (jcode) await installJcodeMcp(args);
    if (grok) installGrokMcp(grok, args);
    if (cursor) await installCursorMcp(args);
  })();
  systemSetupRuns.set(key, run);
  try {
    await run;
  } finally {
    systemSetupRuns.delete(key);
  }
}

function setupEnvFor(kind: CodingAgentKind): Record<string, string> | null {
  if (kind === "claude" || kind === "aisdk") return { LFG_INSTALL_CLAUDE: "1" };
  if (kind === "codex" || kind === "codex-aisdk") return { LFG_INSTALL_CODEX: "1" };
  if (kind === "opencode") return { LFG_INSTALL_OPENCODE: "1" };
  if (kind === "jcode") return { LFG_INSTALL_JCODE: "1" };
  if (kind === "grok") return { LFG_INSTALL_GROK: "1" };
  if (kind === "cursor") return { LFG_INSTALL_CURSOR: "1" };
  if (kind === "fx") return { LFG_INSTALL_FX: "1" };
  if (kind === "copilot") return { LFG_INSTALL_COPILOT: "1" };
  return null;
}

export async function runCodingAgentSetups(kinds: CodingAgentKind[]): Promise<void> {
  const uniqueKinds = [...new Set(kinds)];
  if (!uniqueKinds.length) throw new Error("select at least one coding agent");
  const runningKind = uniqueKinds.find((kind) => setupRuns.has(kind));
  if (runningKind) throw new Error(`${runningKind} setup is already running`);

  const setupEnv: Record<string, string> = {};
  for (const kind of uniqueKinds) {
    const env = setupEnvFor(kind);
    if (!env) throw new Error(`${kind} does not have an automatic setup path`);
    Object.assign(setupEnv, env);
    setupProgress.set(kind, { percent: 10, label: "Starting…" });
  }

  setupLog = {
    running: true,
    kinds: [...uniqueKinds],
    lines: [],
    error: null,
    finishedAt: null,
  };
  appendSetupLog(
    `Installing ${uniqueKinds.map((kind) => CODING_AGENT_LABELS[kind]).join(", ")}…`,
  );

  const script = join(PATHS.root, "scripts", "setup.sh");
  const run = (async () => {
    const proc = Bun.spawn(["bash", script], {
      cwd: PATHS.root,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...setupEnv },
    });
    const readLines = async (
      stream: ReadableStream<Uint8Array>,
      onLine: (line: string) => void,
    ) => {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) onLine(line);
      }
      if (buffered.length) onLine(buffered);
    };
    let installSeen = false;
    const stderrLines: string[] = [];
    const stdout = readLines(proc.stdout, (line) => {
      appendSetupLog(line);
      const message = line.replace(/\x1b\[[0-9;]*m/g, "").replace(/^==>\s*/, "").trim();
      if (!message) return;
      if (/Installing .*CLI|Installing OpenCode/i.test(message)) {
        installSeen = true;
        for (const kind of uniqueKinds) {
          setupProgress.set(kind, { percent: 55, label: message });
        }
      } else if (installSeen) {
        for (const kind of uniqueKinds) {
          setupProgress.set(kind, { percent: 80, label: message });
        }
      }
    });
    const stderr = readLines(proc.stderr, (line) => {
      appendSetupLog(line);
      stderrLines.push(line);
    });
    const [, , code] = await Promise.all([stdout, stderr, proc.exited]);
    if (code !== 0) {
      const detail = stderrLines
        .join("\n")
        .replace(/\x1b\[[0-9;]*m/g, "")
        .trim()
        .slice(0, 1000);
      throw new Error(detail || `setup exited ${code}`);
    }
    for (const kind of uniqueKinds) {
      setupProgress.set(kind, { percent: 95, label: "Verifying installation…" });
    }
  })();
  for (const kind of uniqueKinds) setupRuns.set(kind, run);
  try {
    await run;
    appendSetupLog("Done.");
  } catch (e) {
    setupLog.error = e instanceof Error ? e.message : String(e);
    appendSetupLog(`Error: ${setupLog.error}`);
    throw e;
  } finally {
    setupLog.running = false;
    setupLog.finishedAt = Date.now();
    for (const kind of uniqueKinds) {
      if (setupRuns.get(kind) === run) setupRuns.delete(kind);
      setupProgress.delete(kind);
    }
  }
}

export async function runCodingAgentSetup(kind: CodingAgentKind): Promise<void> {
  return runCodingAgentSetups([kind]);
}

export function isCodingAgentKind(value: string): value is CodingAgentKind {
  return (CODING_AGENT_KINDS as string[]).includes(value);
}
