import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// OpenCode's own config file, which the omg agent's custom model providers
// (src/custom-models.ts) are merged into.

type Config = Record<string, any>;
export type OpenCodeConfigOptions = {
  home?: string;
  env?: Record<string, string | undefined>;
};

function readConfig(path: string): Config {
  if (!existsSync(path)) return {};
  try {
    const value = Bun.JSONC.parse(readFileSync(path, "utf8"));
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch {}
  throw new Error(`Cannot update invalid JSON config: ${path}`);
}

/** The OpenCode config file that provider writers merge into. */
export function openCodeConfigPath(options: OpenCodeConfigOptions = {}): string {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const dir = join(env.XDG_CONFIG_HOME?.trim() || join(home, ".config"), "opencode");
  // Match the existing MCP writer's opencode.json path on a new installation.
  const jsonc = join(dir, "opencode.jsonc");
  return existsSync(jsonc) ? jsonc : join(dir, "opencode.json");
}

export function readOpenCodeConfig(path: string): Config {
  return readConfig(path);
}

/** Atomic write; the file can hold an API key, so it stays owner-only. */
export function writeOpenCodeConfig(path: string, next: Config): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
}
