// Save one secret (API key, internal API URL, token) for a user's app.
//
// The value arrives from the secure ask field and goes to two places: the
// project's `.env`, so local dev and previews read it at once, and the hosted
// app's Cloud env vars when the folder is linked to a deployed app. The value
// is never returned, logged, or stored anywhere else. Callers get key names and
// outcomes only.

import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

import type { CloudAppsClient } from "../packages/cloud/src/apps.ts";
import { resolveEnvTarget } from "./cloud-apps.ts";

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
  localFile?: string;
  /** True when this call added `.env` to `.gitignore`. */
  gitignoreUpdated?: boolean;
  /** set: Cloud has it. not-linked: no deployed app for this folder yet. failed: see cloudError. */
  cloud: "set" | "not-linked" | "failed";
  slug?: string;
  cloudError?: string;
};

export async function saveAppSecret(input: {
  key: string;
  value: string;
  cwd?: string | null;
  slug?: string | null;
  client: CloudAppsClient | null;
}): Promise<SaveAppSecretResult> {
  const key = validateEnvKey(input.key);
  const value = validateSecretValue(input.value);
  const cwd = input.cwd?.trim() || "";
  const slug = input.slug?.trim() || "";
  if (!cwd && !slug) throw new Error("the request has no project folder or app");

  const result: SaveAppSecretResult = { key, cloud: "not-linked" };
  if (cwd) {
    if (!existsSync(cwd)) throw new Error(`project folder not found: ${cwd}`);
    const file = join(cwd, ".env");
    const before = existsSync(file) ? readFileSync(file, "utf8") : "";
    writeFileSync(file, upsertDotenvText(before, key, value), { mode: 0o600 });
    result.localFile = file;
    if (ensureDotenvIgnored(cwd)) result.gitignoreUpdated = true;
  }

  let target: { slug: string; projectId?: string } | null = null;
  try {
    target = resolveEnvTarget({ slug, cwd });
  } catch {
    target = null; // folder not deployed yet
  }
  if (!target) return result;
  result.slug = target.slug;
  if (!input.client) {
    result.cloud = "failed";
    result.cloudError = "this runtime is not signed in to omg Cloud";
    return result;
  }
  try {
    await input.client.setEnv({ ...target, vars: { [key]: value } });
    result.cloud = "set";
  } catch (error) {
    result.cloud = "failed";
    const message = error instanceof Error ? error.message : "Cloud request failed";
    // Never let a Cloud error echo the value back into the transcript.
    result.cloudError = message.split(value).join("[redacted]");
  }
  return result;
}

/** What the asking agent reads. Key names and outcomes only. */
export function formatSecretSavedText(askId: string, saved: SaveAppSecretResult): string {
  const parts = [`[env-set ${saved.key}] The user entered ${saved.key} in the secure field (ask ${askId}).`];
  if (saved.localFile) {
    parts.push(
      `Saved to ${saved.localFile}${saved.gitignoreUpdated ? " and added .env to .gitignore" : ""}. Read it as process.env.${saved.key} on the server side; do not put it in client code.`,
    );
  }
  if (saved.cloud === "set") {
    parts.push(`Also set on hosted app ${saved.slug}. It applies on the next omg_deploy.`);
  } else if (saved.cloud === "not-linked") {
    parts.push("No hosted app is linked yet. After the first omg_deploy, call omg_app_env with action import to copy .env to the app.");
  } else {
    parts.push(`Setting it on hosted app ${saved.slug ?? ""} failed: ${saved.cloudError}. Retry later with omg_app_env action import.`);
  }
  parts.push("Do not ask the user to paste the value in chat, and never print it.");
  return parts.join(" ");
}
