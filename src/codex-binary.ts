// Which codex binary a codex-aisdk session runs.
//
// Two copies of Codex exist on a typical install:
//   - the GLOBAL CLI (`bun add -g @openai/codex`), which the Settings "Update"
//     button installs and which model discovery reads to fill the model picker;
//   - the BUNDLED CLI that @openai/codex-sdk pins in omg.dev's own
//     node_modules, which only changes with an omg.dev release.
//
// Sessions used to run the bundled copy only. When OpenAI shipped gpt-6.2-astra
// the global CLI (0.169.0) listed it, so the picker offered it, but the bundled
// CLI (0.159.2) was too old: OpenAI filters a ChatGPT account's models by
// client version and answered `model_not_found`. Updating Codex from Settings
// did not help, because the session never ran the updated copy.
//
// Rule: run whichever copy is NEWER. The bundled copy wins a tie (it is the
// SDK's tested pairing) and whenever the global CLI is missing, unreadable, or
// older, so an outdated global install can never downgrade a session.
// An explicit LFG_CODEX_PATH still overrides everything.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { whichRunnable } from "./runnable-bin.ts";

const CODEX_PACKAGE = "@openai/codex";

/** `codex-cli 0.169.0` / `0.169.0-alpha.3` → `0.169.0`; null when absent. */
export function parseCodexVersion(text: string | null | undefined): string | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text ?? "");
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

/** Numeric major.minor.patch comparison. Negative when a < b. */
export function compareCodexVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Version of the @openai/codex package the installed codex-sdk depends on. */
function bundledCodexVersion(): string | null {
  try {
    const sdkEntry = fileURLToPath(import.meta.resolve("@openai/codex-sdk"));
    const pkgPath = createRequire(sdkEntry).resolve(`${CODEX_PACKAGE}/package.json`);
    return parseCodexVersion(JSON.parse(readFileSync(pkgPath, "utf8")).version);
  } catch {
    return null;
  }
}

/**
 * Version of a codex executable. Reads the owning @openai/codex package.json
 * when the path is an npm/bun install (no process spawn), else asks the binary.
 */
export function codexBinaryVersion(path: string): string | null {
  try {
    let dir = dirname(realpathSync(path));
    for (let i = 0; i < 4; i++) {
      const pkgPath = join(dir, "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string; version?: string };
        if (pkg.name === CODEX_PACKAGE) return parseCodexVersion(pkg.version);
      }
      dir = dirname(dir);
    }
  } catch {
    // fall through to asking the binary
  }
  try {
    const out = spawnSync(path, ["--version"], { encoding: "utf8", timeout: 5_000 });
    return out.status === 0 ? parseCodexVersion(out.stdout) : null;
  } catch {
    return null;
  }
}

/** The global Codex CLI, searched the same way Settings finds it. */
function globalCodexPath(env: NodeJS.ProcessEnv): string | null {
  const home = env.HOME || homedir();
  return whichRunnable(
    "codex",
    [`${home}/.local/bin/codex`, `${home}/.bun/bin/codex`, "/usr/local/bin/codex"],
    env,
  );
}

export interface CodexSessionBinaryDeps {
  env?: NodeJS.ProcessEnv;
  bundledVersion?: () => string | null;
  globalPath?: (env: NodeJS.ProcessEnv) => string | null;
  versionOf?: (path: string) => string | null;
}

/**
 * The `codexPathOverride` for the SDK, or undefined to run the bundled binary.
 */
export function resolveCodexSessionBinary(deps: CodexSessionBinaryDeps = {}): string | undefined {
  const env = deps.env ?? process.env;
  const explicit = env.LFG_CODEX_PATH;
  if (explicit) {
    try {
      const real = realpathSync(explicit);
      return existsSync(real) ? real : undefined;
    } catch {
      return undefined;
    }
  }

  const globalPath = (deps.globalPath ?? globalCodexPath)(env);
  if (!globalPath) return undefined;
  const globalVersion = (deps.versionOf ?? codexBinaryVersion)(globalPath);
  if (!globalVersion) return undefined;
  const bundled = (deps.bundledVersion ?? bundledCodexVersion)();
  if (bundled && compareCodexVersions(globalVersion, bundled) <= 0) return undefined;
  // Bundled version unknown means the SDK cannot find its own binary either;
  // a runnable global CLI is the better choice then.
  return globalPath;
}
