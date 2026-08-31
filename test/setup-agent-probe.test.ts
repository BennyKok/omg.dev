// Probing for an agent CLI must not be able to abort the install.
//
// This shipped broken in v0.1.315. The probe was written as
//
//     command -v codex >/dev/null 2>&1; ensure_agent codex "$FLAG" "$?"
//
// which reads as "check, then report the result" and is not: under
// `set -euo pipefail` a probe returning non-zero ends the script. Setup died on
// the first agent that was not installed — i.e. on essentially every real
// machine — with "setup failed at line 472" and no explanation.
//
// It survived review and a full local run because the development box happened
// to have every agent CLI installed, so no probe ever returned non-zero. The
// case worth testing is the empty machine, not the fully-equipped one.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SETUP_SH, extractFunctionSource } from "./setup-script-helpers.ts";

/**
 * Every `LFG_INSTALL_*` flag setup.sh defines, pinned off.
 *
 * The agent block runs under `set -u`, so any flag it reads that the harness
 * has not defined kills the script. Reading the names out of setup.sh keeps
 * this harness correct as agents come and go.
 */
function installFlagStubs(source: string): string[] {
  const names = new Set(
    [...source.matchAll(/^(LFG_INSTALL_[A-Z0-9_]+)=/gm)].map((match) => match[1]),
  );
  return [...names].map((name) => `${name}=0`);
}

/**
 * Run the agent-detection block with a chosen set of CLIs "installed".
 * Returns the reported ready/missing lists, or null if the script aborted.
 */
function probeAgents(present: string[]): { ready: string[]; missing: string[] } | null {
  const source = readFileSync(SETUP_SH, "utf8");
  const start = source.indexOf("AGENTS_READY=()");
  const end = source.indexOf("# ---- 4. fetch", start);
  expect(start, "agent block not found").toBeGreaterThanOrEqual(0);
  expect(end, "end of agent block not found").toBeGreaterThan(start);

  const script = [
    // The real script's failure mode only exists under these flags.
    "set -euo pipefail",
    'say() { :; }',
    'warn() { :; }',
    'ensure_path_line() { :; }',
    'BUN_BIN=/bin/true',
    // Derived from setup.sh, not hardcoded. This list used to be spelled out
    // here, so adding an agent left the stub set one short: `deepseek` landed,
    // `LFG_INSTALL_DEEPSEEK` went unset, and `set -u` aborted the block before
    // a single assertion ran. All four tests in this file went red for a reason
    // unrelated to what they check, which is how a real regression would hide.
    ...installFlagStubs(source),
    'LFG_COPILOT_VERSION=latest',
    // pi is probed by file path rather than by PATH lookup, so the block needs
    // an install directory. Point it somewhere that cannot exist.
    'LFG_DIR=/nonexistent-omg-root',
    // Stub `command` so only the chosen CLIs look installed.
    `PRESENT="${present.join(" ")}"`,
    `command() {
       if [ "\${1:-}" = "-v" ]; then
         case " $PRESENT " in *" \${2} "*) return 0 ;; *) return 1 ;; esac
       fi
       builtin command "$@"
     }`,
    source.slice(start, end),
    'printf "READY:%s\\n" "$(IFS=,; echo "${AGENTS_READY[*]-}")"',
    'printf "MISSING:%s\\n" "$(IFS=,; echo "${AGENTS_MISSING[*]-}")"',
  ].join("\n");

  const result = Bun.spawnSync(["bash", "-c", script]);
  const stdout = new TextDecoder().decode(result.stdout);
  if (result.exitCode !== 0) return null;
  const pick = (prefix: string) =>
    (stdout.split("\n").find(l => l.startsWith(prefix))?.slice(prefix.length) ?? "")
      .split(",")
      .filter(Boolean);
  return { ready: pick("READY:"), missing: pick("MISSING:") };
}

describe("agent detection", () => {
  // The regression, stated plainly.
  test("a machine with no agent CLIs does not abort setup", () => {
    const result = probeAgents([]);
    expect(result, "setup aborted while probing for agents").not.toBeNull();
    expect(result!.ready).toEqual([]);
    expect(result!.missing).toContain("codex");
    expect(result!.missing).toContain("claude");
  });

  test("a machine with every agent reports them all ready", () => {
    const result = probeAgents(["claude", "codex", "opencode", "jcode", "grok", "cursor-agent", "fx", "copilot"]);
    expect(result).not.toBeNull();
    expect(result!.ready).toContain("claude");
    expect(result!.ready).toContain("codex");
    // Neither of these is a PATH lookup, so "every CLI installed" cannot make
    // them ready. pi is probed by file and is not bundled any more. deepseek is
    // probed by `deepseek_harness_ready`, a function defined above the block
    // under test. Both are opt-in, so both read missing here by design.
    expect(result!.missing).toEqual(["deepseek", "pi"]);
  });

  // The realistic middle: some installed, some not. This is the shape that was
  // broken, and the one a fresh user actually has.
  test("a partial install is reported without aborting", () => {
    const result = probeAgents(["claude"]);
    expect(result, "setup aborted on the first missing agent").not.toBeNull();
    expect(result!.ready).toEqual(["claude"]);
    expect(result!.missing).toContain("codex");
    expect(result!.missing).toContain("opencode");
  });

  test("hermes is not probed for at all any more", () => {
    const result = probeAgents([]);
    expect(result).not.toBeNull();
    expect([...result!.ready, ...result!.missing]).not.toContain("hermes");
  });

  // Guards the specific construct, so the shape cannot come back by hand.
  test("no probe result is passed through $? in a bare statement", () => {
    const source = readFileSync(SETUP_SH, "utf8");
    expect(source).not.toMatch(/command -v \w+ >\/dev\/null 2>&1;\s*ensure_agent/);
    expect(extractFunctionSource("ensure_agent")).toContain('if "$@"');
  });
});
