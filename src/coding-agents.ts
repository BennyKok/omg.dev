import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";

export type CodingAgentKind =
  | "claude"
  | "aisdk"
  | "codex"
  | "codex-aisdk"
  | "opencode"
  | "grok"
  | "hermes";

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
  checks: CodingAgentCheck[];
  instructions: string[];
  canAutoSetup: boolean;
  setupRunning: boolean;
};

export type CodingAgentInfo = {
  key: CodingAgentKind;
  label: string;
  visible: boolean;
  status: CodingAgentStatus;
};

export const CODING_AGENT_KINDS: CodingAgentKind[] = [
  "aisdk",
  "codex-aisdk",
  "grok",
  "hermes",
  "opencode",
];

export const CODING_AGENT_LABELS: Record<CodingAgentKind, string> = {
  claude: "claude",
  aisdk: "claude",
  codex: "codex",
  "codex-aisdk": "codex",
  opencode: "opencode",
  grok: "grok",
  hermes: "hermes",
};

const CONFIG_PATH = join(PATHS.data, "coding-agents.json");
const setupRuns = new Map<CodingAgentKind, Promise<void>>();

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function getCodingAgentConfig(): Promise<CodingAgentConfig> {
  const raw = readJson<CodingAgentConfig>(CONFIG_PATH);
  return { agents: raw?.agents ?? {} };
}

export async function setCodingAgentVisibility(
  kind: CodingAgentKind,
  visible: boolean,
): Promise<CodingAgentConfig> {
  const cfg = await getCodingAgentConfig();
  cfg.agents[kind] = { ...(cfg.agents[kind] ?? {}), visible };
  await mkdir(PATHS.data, { recursive: true });
  await Bun.write(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  return cfg;
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

function hermesPath(): string | null {
  const home = userHome();
  return which("hermes", [
    process.env.LFG_HERMES_PATH ?? "",
    `${home}/.local/bin/hermes`,
    `${home}/.bun/bin/hermes`,
    "/usr/local/bin/hermes",
  ]);
}

function hasClaudeAuth(): boolean {
  const home = userHome();
  return !!process.env.ANTHROPIC_API_KEY || existsSync(`${home}/.claude/.credentials.json`);
}

function hasCodexAuth(): boolean {
  const home = userHome();
  return (
    !!process.env.OPENAI_API_KEY ||
    existsSync(`${home}/.codex/auth.json`) ||
    existsSync(`${home}/.codex/config.toml`)
  );
}

function hasGrokAuth(): boolean {
  const home = userHome();
  return !!process.env.XAI_API_KEY || existsSync(`${home}/.grok`);
}

function hasHermesConfig(): boolean {
  const home = userHome();
  return !!process.env.LFG_HERMES_PROVIDER || existsSync(`${home}/.hermes`);
}

function statusFor(kind: CodingAgentKind): CodingAgentStatus {
  const checks: CodingAgentCheck[] = [];
  const instructions: string[] = [];
  let canAutoSetup = true;

  const addBinary = (label: string, path: string | null) => {
    checks.push({ label, ok: !!path, detail: path ?? "not found" });
  };
  const addAuth = (label: string, ok: boolean, detail: string) => {
    checks.push({ label, ok, detail });
  };

  if (kind === "claude" || kind === "aisdk") {
    addBinary("Claude CLI", claudePath());
    addAuth("Claude auth", hasClaudeAuth(), "run `claude` once or set ANTHROPIC_API_KEY");
    instructions.push("Run `claude` once and finish the browser sign-in, or set ANTHROPIC_API_KEY.");
  } else if (kind === "codex" || kind === "codex-aisdk") {
    addBinary("Codex CLI", codexPath());
    addAuth("Codex auth", hasCodexAuth(), "run `codex` once or set OPENAI_API_KEY");
    instructions.push("Run `codex` once and sign in, or set OPENAI_API_KEY.");
  } else if (kind === "opencode") {
    addBinary("OpenCode CLI", opencodePath());
    instructions.push("Install/authenticate OpenCode, then verify `opencode` works from this user.");
  } else if (kind === "hermes") {
    addBinary("Hermes CLI", hermesPath());
    addAuth("Hermes config", hasHermesConfig(), "set LFG_HERMES_PROVIDER if your install needs it");
    instructions.push("Install Hermes and set LFG_HERMES_PROVIDER when your provider is not the default.");
  } else {
    addBinary("Grok CLI", grokPath());
    addAuth("Grok auth", hasGrokAuth(), "run `grok` once or set XAI_API_KEY");
    instructions.push("Install Grok, then run `grok` once and sign in, or set XAI_API_KEY.");
    canAutoSetup = false;
  }

  return {
    configured: checks.every((c) => c.ok),
    checks,
    instructions,
    canAutoSetup,
    setupRunning: setupRuns.has(kind),
  };
}

export async function listCodingAgents(): Promise<CodingAgentInfo[]> {
  const cfg = await getCodingAgentConfig();
  return CODING_AGENT_KINDS.map((key) => ({
    key,
    label: CODING_AGENT_LABELS[key],
    visible: cfg.agents[key]?.visible !== false,
    status: statusFor(key),
  }));
}

function setupEnvFor(kind: CodingAgentKind): Record<string, string> | null {
  if (kind === "claude" || kind === "aisdk") return { LFG_INSTALL_CLAUDE: "1" };
  if (kind === "codex" || kind === "codex-aisdk") return { LFG_INSTALL_CODEX: "1" };
  if (kind === "opencode") return { LFG_INSTALL_OPENCODE: "1" };
  if (kind === "hermes") return { LFG_INSTALL_HERMES: "1" };
  return null;
}

export async function runCodingAgentSetup(kind: CodingAgentKind): Promise<void> {
  if (setupRuns.has(kind)) throw new Error(`${kind} setup is already running`);
  const setupEnv = setupEnvFor(kind);
  if (!setupEnv) throw new Error(`${kind} does not have an automatic setup path`);
  const script = join(PATHS.root, "scripts", "setup.sh");
  const run = (async () => {
    const proc = Bun.spawn(["bash", script], {
      cwd: PATHS.root,
      stdout: "ignore",
      stderr: "pipe",
      env: { ...process.env, ...setupEnv },
    });
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) {
      throw new Error(stderr.trim().slice(0, 1000) || `setup exited ${code}`);
    }
  })();
  setupRuns.set(kind, run);
  try {
    await run;
  } finally {
    setupRuns.delete(kind);
  }
}

export function isCodingAgentKind(value: string): value is CodingAgentKind {
  return (CODING_AGENT_KINDS as string[]).includes(value);
}
