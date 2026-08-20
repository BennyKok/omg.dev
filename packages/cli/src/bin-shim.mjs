#!/bin/sh
':' //; for omg_rt in "${OMG_BUN_PATH:-}" "${BUN_PATH:-}" "$(command -v bun || true)" "$HOME/.bun/bin/bun" "${BUN_INSTALL:-/nonexistent}/bin/bun" /opt/homebrew/bin/bun /usr/local/bin/bun "$(command -v node || true)"; do
':' //;   [ -n "$omg_rt" ] && [ -x "$omg_rt" ] && exec "$omg_rt" "$0" "$@"
':' //; done
':' //; echo 'omg: this CLI runs on Bun, which was not found on this machine.' >&2
':' //; echo '  Install Bun:   curl -fsSL https://bun.sh/install | bash' >&2
':' //; exit 1
/**
 * POSIX trampoline plus JS re-exec for the published `omg` bin.
 *
 * The documented `bun install --global @omg-dev/cli` installs onto machines
 * that have Bun and no Node. A `#!/usr/bin/env node` shebang then dies with
 * `env: node: No such file or directory`. A `#!/usr/bin/env bun` shebang dies
 * the other way on an npm-only box. `sh` is present on every platform this
 * installer supports. `':' //;` is a no-op label in sh and a string-plus
 * comment in JS, so this file stays a valid ES module.
 *
 * Finding Bun in the usual install locations matters because npm's global bin
 * PATH often omits ~/.bun/bin.
 */
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const BUN_ENTRY = "omg-bun.mjs";

export function resolveBun({
  env = process.env,
  exists = existsSync,
  platform = process.platform,
  self = typeof Bun !== "undefined" ? process.execPath : null,
} = {}) {
  const binary = platform === "win32" ? "bun.exe" : "bun";
  if (self && exists(self)) return self;
  const explicit = env.OMG_BUN_PATH || env.BUN_PATH;
  if (explicit && exists(explicit)) return explicit;
  for (const dir of (env.PATH || "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, binary);
    if (exists(candidate)) return candidate;
  }
  const home = env.HOME || env.USERPROFILE || "";
  const fallbacks = [
    env.BUN_INSTALL ? join(env.BUN_INSTALL, "bin", binary) : null,
    home ? join(home, ".bun", "bin", binary) : null,
    "/opt/homebrew/bin/bun",
    "/usr/local/bin/bun",
  ].filter(Boolean);
  for (const candidate of fallbacks) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

export const MISSING_BUN_MESSAGE = [
  "omg: this CLI runs on Bun, which was not found on this machine.",
  "",
  "  Install Bun:   curl -fsSL https://bun.sh/install | bash",
  "  Then re-run:   omg <command>",
  "",
  "Already installed? Point at it with OMG_BUN_PATH=/path/to/bun.",
].join("\n");

export function run(
  argv,
  { env = process.env, exists = existsSync, spawn = spawnSync, stderr = process.stderr, entryDir } = {},
) {
  const bun = resolveBun({ env, exists });
  if (!bun) {
    stderr.write(`${MISSING_BUN_MESSAGE}\n`);
    return 1;
  }
  const dir = entryDir ?? dirname(fileURLToPath(import.meta.url));
  const childEnv = {
    ...env,
    OMG_ORIGINAL_PATH: env.PATH ?? "",
    PATH: `${dirname(bun)}${delimiter}${env.PATH ?? ""}`,
  };
  const result = spawn(bun, [join(dir, BUN_ENTRY), ...argv], { stdio: "inherit", env: childEnv });
  if (result.signal) return 128;
  return result.status ?? 1;
}

function invokedDirectly() {
  const arg = process.argv[1];
  if (!arg) return false;
  const self = fileURLToPath(import.meta.url);
  if (self === arg) return true;
  try {
    return realpathSync(self) === realpathSync(arg);
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  process.exit(run(process.argv.slice(2)));
}
