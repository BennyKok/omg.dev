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

/** Absolute path to the `claude` binary, or undefined to let the SDK decide. */
export function resolveClaudePath(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  try {
    return env.LFG_CLAUDE_PATH?.trim() || Bun.which("claude") || undefined;
  } catch {
    return undefined;
  }
}
