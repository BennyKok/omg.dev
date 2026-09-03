// Filesystem isolation for a restricted coding-agent harness, via bubblewrap.
//
// A sandboxed session sees only what it needs to work: the system read-only,
// its own worktree read-write, the omg code tree and Bun read-only so the
// harness can run, and nothing else. Everything that would let a restricted
// session read another project, another user's worktree, the box's SSH or
// cloud keys, or omg's own secrets (the session-token secret, the Executor
// bearer, roles) is absent, because home is a fresh tmpfs and the omg data
// dir is masked even though the code tree around it is exposed.
//
// Network is deliberately shared: the harness still needs the model API and
// the omg MCP endpoint on loopback. Per-host network restriction is a
// separate, larger piece (a local proxy or nftables in the namespace) and is
// not attempted here. See docs/team-tooling-design.md.
//
// The credential model this relies on: a process-supervised harness (aisdk,
// codex-aisdk, pi) receives its model credentials through the environment,
// which bwrap passes through, not through a file under home. So an empty home
// costs the harness nothing and withholds the owner's stored logins from a
// restricted role.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

export type SandboxMode = "none" | "bwrap";

export interface BwrapPlan {
  /** The worktree the session runs in; the only writable project path. */
  worktree: string;
  /** The omg install tree, exposed read-only so the harness script resolves. */
  omgRoot: string;
  /** The omg data dir, masked with a tmpfs so its secrets are not readable. */
  dataDir: string;
  /** Absolute path of the runtime binary (bun); its dir is exposed read-only. */
  runtime: string;
  /** Home directory, replaced with an empty tmpfs. */
  home: string;
}

/** True when bubblewrap can be used on this box. */
export function bwrapAvailable(bin: string | null = bwrapBinary()): boolean {
  return process.platform === "linux" && bin !== null;
}

export function bwrapBinary(): string | null {
  const override = process.env.OMG_BWRAP_BIN?.trim();
  if (override) return existsSync(override) ? override : null;
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (!dir) continue;
    const candidate = `${dir}/bwrap`;
    if (existsSync(candidate)) return candidate;
  }
  return existsSync("/usr/bin/bwrap") ? "/usr/bin/bwrap" : null;
}

// System paths mounted read-only when present. /etc is read-only whole: the
// harness needs resolv.conf and the CA bundle, and a restricted session has no
// business writing any of it.
const SYSTEM_ROOTS = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/lib32", "/etc", "/opt", "/nix"];

/**
 * Build the bubblewrap argv that runs `command` in the sandbox described by
 * `plan`. Pure: no filesystem writes, only `existsSync` probes for optional
 * system paths, so it is fully unit-testable.
 */
export function bwrapArgv(command: string[], plan: BwrapPlan, bin = bwrapBinary() ?? "/usr/bin/bwrap"): string[] {
  const worktree = resolve(plan.worktree);
  const omgRoot = resolve(plan.omgRoot);
  const dataDir = resolve(plan.dataDir);
  const home = resolve(plan.home);
  const runtimeDir = dirname(resolve(plan.runtime));

  const argv = [bin, "--die-with-parent"];
  for (const root of SYSTEM_ROOTS) {
    if (existsSync(root)) argv.push("--ro-bind", root, root);
  }
  argv.push("--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp");
  // An empty home first; the specific subtrees the harness needs are layered
  // back on top afterwards, so nothing else under home survives.
  argv.push("--tmpfs", home);
  // The omg code tree, read-only, then its data dir masked. Order matters:
  // the tmpfs must come AFTER the ro-bind so it hides the secrets inside it.
  argv.push("--ro-bind", omgRoot, omgRoot);
  if (dataDir.startsWith(omgRoot)) argv.push("--tmpfs", dataDir);
  // The runtime (bun) directory, in case it lives under the masked home.
  if (!runtimeDir.startsWith(omgRoot)) argv.push("--ro-bind", runtimeDir, runtimeDir);
  // The worktree is the one writable project path.
  argv.push("--bind", worktree, worktree);
  argv.push("--chdir", worktree);
  // Isolate every namespace except the network: the harness still needs the
  // model API and the omg MCP endpoint on loopback.
  argv.push(
    "--unshare-user",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--unshare-cgroup",
  );
  argv.push("--", ...command);
  return argv;
}

/**
 * Wrap `command` for the requested sandbox mode.
 *
 * `none`, a non-linux host, or a missing bwrap all return the command
 * unchanged; the caller decides whether that silent fallback is acceptable
 * for the session (it logs a warning). `defaultPlan` supplies the standard
 * bindings from this box's own paths.
 */
export function sandboxCommand(
  command: string[],
  mode: SandboxMode,
  plan: Pick<BwrapPlan, "worktree" | "omgRoot" | "dataDir">,
  bin: string | null = bwrapBinary(),
): { command: string[]; sandboxed: boolean; reason?: string } {
  if (mode !== "bwrap") return { command, sandboxed: false };
  if (!bwrapAvailable(bin)) {
    return { command, sandboxed: false, reason: "bubblewrap is not available on this host" };
  }
  const full: BwrapPlan = {
    ...plan,
    runtime: process.execPath,
    home: process.env.HOME ?? homedir(),
  };
  return { command: bwrapArgv(command, full, bin ?? undefined), sandboxed: true };
}
