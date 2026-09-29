import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Resolve the installed `claude` binary for the Agent SDK harnesses, which
// pass it as `pathToClaudeCodeExecutable`. Shared by aisdk-session.ts and
// claude-ai-sdk.ts so the empty-override rule below is stated exactly once.
//
// An UNSET override falls through to PATH — and an override set to the empty
// string counts as unset. `.env.example` used to ship `OMG_CLAUDE_PATH=`, the
// launchd/systemd unit sources it with `set -a`, and applyEnvAliases
// deliberately mirrors the empty string onto LFG_CLAUDE_PATH (empty is a real
// value there — see env-compat.test.ts). A `??` check let that empty string
// beat Bun.which, so `pathToClaudeCodeExecutable` was dropped from the query
// options and the SDK fell back to a bundled native binary that a tarball
// install does not ship. Every managed session then died at launch with
// "Native CLI binary for <platform> not found", surfacing to the user as a
// session stuck at `launching` forever rather than as an error.

// PATH is not enough on its own. A harness relaunched from a mangled
// environment (a manual recovery script, a unit with a trimmed PATH) could not
// see ~/.local/bin, so the SDK fell back to its bundled binary. On 2026-09-29
// that bundled 2.1.206 was rejected by the API with "does not support this
// model; version 2.1.280 or newer is required", while ~/.local/bin/claude was
// 2.1.283. The installer's fixed locations are therefore checked before the
// SDK is left to decide.
function installedClaudeCandidates(env: Record<string, string | undefined>): string[] {
  const home = env.HOME?.trim() || homedir();
  if (!home) return [];
  return [join(home, ".local", "bin", "claude"), join(home, ".claude", "local", "claude")];
}

/** Absolute path to the `claude` binary, or undefined to let the SDK decide. */
export function resolveClaudePath(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  try {
    const override = env.LFG_CLAUDE_PATH?.trim();
    if (override) return override;
    const onPath = Bun.which("claude", { PATH: env.PATH ?? process.env.PATH ?? "" });
    if (onPath) return onPath;
    return installedClaudeCandidates(env).find((candidate) => existsSync(candidate));
  } catch {
    return undefined;
  }
}

/**
 * One log line naming the binary a harness will drive. The installer links
 * ~/.local/bin/claude to versions/<semver>, so the resolved target carries the
 * version without spawning `claude --version` on every launch.
 */
export function describeClaudeBinary(path: string | undefined): string {
  if (!path) return "SDK bundled claude binary (no installed claude found)";
  try {
    const target = realpathSync(path);
    return target === path ? path : `${path} -> ${target}`;
  } catch {
    return `${path} (not found)`;
  }
}
