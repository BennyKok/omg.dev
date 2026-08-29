import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { CodingAgentKind } from "./coding-agents.ts";

/**
 * The account a coding agent is signed in to on this device.
 *
 * Detection already answers "is an account connected" as a boolean. That is
 * enough to gate a model picker, and not enough to onboard: a user with three
 * agents connected under two different logins cannot tell which is which, and
 * multi-account Claude shows synthetic "Claude 1" / "Claude 2" labels that
 * name nothing. This is the identity behind that boolean.
 *
 * Every field here is safe to render. Credential material is never copied into
 * this shape, and the readers below take only the identity claims they name.
 */
export type AgentAccountProfile = {
  /** Who is signed in. An email address when the agent records one. */
  label: string;
  /** Plan or tier, when the credential states one. Example: "Max", "Plus". */
  detail?: string;
  /** Where the identity was read. Only local credential files are read today. */
  source: "local-cli";
};

function userHome(): string {
  return process.env.HOME ?? homedir();
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Turn a vendor plan code into something a person reads. Anthropic reports
 * `claude_max`, OpenAI reports `plus`. Both become "Max" and "Plus".
 */
function planLabel(raw: unknown): string | undefined {
  const value = text(raw);
  if (!value) return undefined;
  const trimmed = value.replace(/^claude[_-]/i, "").replace(/[_-]+/g, " ").trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function profile(label: string | undefined, detail?: string): AgentAccountProfile | null {
  return label ? { label, ...(detail ? { detail } : {}), source: "local-cli" } : null;
}

/**
 * Decode the claims of a JWT without verifying it. The token is already a
 * local credential this process may read, and nothing here is trusted for
 * authorization — it only supplies display text.
 */
function jwtClaims(token: unknown): Record<string, unknown> | null {
  if (typeof token !== "string") return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Claude records the signed-in account in `.claude.json`, beside the config
 * directory rather than inside it. With `CLAUDE_CONFIG_DIR` set — which is how
 * this repository isolates each extra account — the file moves inside that
 * directory, so both places are checked, nearest first.
 */
export function claudeAccountProfile(configDir: string): AgentAccountProfile | null {
  const inside = join(configDir, ".claude.json");
  const path = existsSync(inside) ? inside : join(dirname(configDir), ".claude.json");
  const account = readJson<{
    oauthAccount?: { emailAddress?: unknown; displayName?: unknown; organizationType?: unknown };
  }>(path)?.oauthAccount;
  if (!account || typeof account !== "object") return null;
  return profile(
    text(account.emailAddress) ?? text(account.displayName),
    planLabel(account.organizationType),
  );
}

/**
 * Codex stores an OpenID token in ~/.codex/auth.json. The email and the
 * ChatGPT plan are both claims on it. An OPENAI_API_KEY alone is a platform
 * key, not a user login, so it yields no profile.
 */
export function codexAccountProfile(): AgentAccountProfile | null {
  const auth = readJson<{ tokens?: { id_token?: unknown } }>(
    join(userHome(), ".codex", "auth.json"),
  );
  const claims = jwtClaims(auth?.tokens?.id_token);
  if (!claims) return null;
  const openai = claims["https://api.openai.com/auth"] as { chatgpt_plan_type?: unknown } | undefined;
  return profile(text(claims.email) ?? text(claims.name), planLabel(openai?.chatgpt_plan_type));
}

/** `cursor-agent login` writes the identity to ~/.cursor/cli-config.json. */
export function cursorAccountProfile(): AgentAccountProfile | null {
  const info = readJson<{ authInfo?: { email?: unknown; displayName?: unknown } }>(
    join(userHome(), ".cursor", "cli-config.json"),
  )?.authInfo;
  if (!info || typeof info !== "object") return null;
  return profile(text(info.email) ?? text(info.displayName));
}

/**
 * `grok login` writes ~/.grok/auth.json as a map of issuer::client-id -> entry.
 * Only an entry holding a key is a completed sign-in, which is the same rule
 * the connected check applies.
 */
export function grokAccountProfile(): AgentAccountProfile | null {
  const root = readJson<Record<string, { key?: unknown; email?: unknown; first_name?: unknown } | null>>(
    join(userHome(), ".grok", "auth.json"),
  );
  if (!root || typeof root !== "object") return null;
  for (const entry of Object.values(root)) {
    if (!entry || typeof entry !== "object") continue;
    if (!text(entry.key)) continue;
    const found = profile(text(entry.email) ?? text(entry.first_name));
    if (found) return found;
  }
  return null;
}

/**
 * The profile for one agent kind, or null when the agent records no identity
 * on disk. Kinds that only ever hold an API key have no account to name and
 * are absent by design rather than by omission.
 */
export function agentAccountProfile(
  kind: CodingAgentKind,
  claudeConfigDir?: string | null,
): AgentAccountProfile | null {
  if (kind === "claude" || kind === "aisdk") {
    return claudeConfigDir ? claudeAccountProfile(claudeConfigDir) : null;
  }
  if (kind === "codex" || kind === "codex-aisdk") return codexAccountProfile();
  if (kind === "cursor") return cursorAccountProfile();
  if (kind === "grok") return grokAccountProfile();
  return null;
}
