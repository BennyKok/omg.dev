// Save one secret (API key, internal API URL, token) for a user's project.
//
// The value arrives from the secure ask field and goes to one place: the
// project's `.env` on this computer. It is never returned, logged, sent off the
// machine, or stored anywhere else. Callers get key names and outcomes only.

import { appendFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Same rule as a shell variable name, which is what the app will read. */
export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const MAX_SECRET_VALUE_BYTES = 16 * 1024;

export function validateEnvKey(key: unknown): string {
  const trimmed = typeof key === "string" ? key.trim() : "";
  if (!ENV_KEY_PATTERN.test(trimmed)) {
    throw new Error("key must be letters, digits and underscores, and must not start with a digit");
  }
  return trimmed;
}

export function validateSecretValue(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("value is required");
  // Paste from a password manager often carries a trailing newline.
  const trimmed = value.replace(/^\s+|\s+$/g, "");
  if (Buffer.byteLength(trimmed) > MAX_SECRET_VALUE_BYTES) {
    throw new Error(`value is larger than ${MAX_SECRET_VALUE_BYTES} bytes`);
  }
  return trimmed;
}

/** One dotenv line. Plain values stay bare; anything else is double-quoted. */
export function formatDotenvLine(key: string, value: string): string {
  if (/^[A-Za-z0-9_\-.:/+=@,~]*$/.test(value)) return `${key}=${value}`;
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n");
  return `${key}="${escaped}"`;
}

/** Replace KEY's line in a dotenv text, or append it. Other lines stay as they are. */
export function upsertDotenvText(text: string, key: string, value: string): string {
  const line = formatDotenvLine(key, value);
  const matcher = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
  const lines = text.length ? text.replace(/\n$/, "").split("\n") : [];
  let replaced = false;
  const next: string[] = [];
  for (const current of lines) {
    if (matcher.test(current)) {
      if (!replaced) next.push(line);
      replaced = true;
      continue;
    }
    next.push(current);
  }
  if (!replaced) next.push(line);
  return `${next.join("\n")}\n`;
}

/**
 * Keep `.env` out of git. Only acts inside a git work tree, and only when git
 * says the file is not ignored already.
 */
export function ensureDotenvIgnored(cwd: string): boolean {
  const check = Bun.spawnSync(["git", "check-ignore", "-q", ".env"], { cwd, stdout: "ignore", stderr: "ignore" });
  if (check.exitCode === 0) return false; // already ignored
  if (check.exitCode !== 1) return false; // not a git work tree, or git failed
  const gitignore = join(cwd, ".gitignore");
  const current = existsSync(gitignore) ? readFileSync(gitignore, "utf8") : "";
  appendFileSync(gitignore, `${current && !current.endsWith("\n") ? "\n" : ""}.env\n`);
  return true;
}

export type SaveAppSecretResult = {
  key: string;
  /** Absolute path of the `.env` that now holds the key. */
  localFile: string;
  /** True when this call added `.env` to `.gitignore`. */
  gitignoreUpdated?: boolean;
};

export async function saveAppSecret(input: {
  key: string;
  value: string;
  cwd?: string | null;
}): Promise<SaveAppSecretResult> {
  const key = validateEnvKey(input.key);
  const value = validateSecretValue(input.value);
  const cwd = input.cwd?.trim() || "";
  if (!cwd) throw new Error("the request has no project folder");
  if (!existsSync(cwd)) throw new Error(`project folder not found: ${cwd}`);
  const file = join(cwd, ".env");
  const before = existsSync(file) ? readFileSync(file, "utf8") : "";
  writeFileSync(file, upsertDotenvText(before, key, value), { mode: 0o600 });
  // `mode` applies only when the file is created. An existing .env keeps its
  // old bits, often 0644, so tighten it now that it holds a secret.
  chmodSync(file, 0o600);
  const result: SaveAppSecretResult = { key, localFile: file };
  if (ensureDotenvIgnored(cwd)) result.gitignoreUpdated = true;
  return result;
}

/** What the asking agent reads. Key names and outcomes only. */
export function formatSecretSavedText(askId: string, saved: SaveAppSecretResult): string {
  return [
    `[env-set ${saved.key}] The user entered ${saved.key} in the secure field (ask ${askId}).`,
    `Saved to ${saved.localFile}${saved.gitignoreUpdated ? " and added .env to .gitignore" : ""}. Read it as process.env.${saved.key} on the server side; do not put it in client code.`,
    "Do not ask the user to paste the value in chat, and never print it.",
  ].join(" ");
}
