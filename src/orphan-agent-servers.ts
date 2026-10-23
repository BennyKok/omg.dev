// Stop `opencode serve` processes whose omg.dev harness is gone.
//
// Every OpenCode session runs its own `opencode serve` child. When the harness
// dies without closing it (SIGKILL, an out-of-memory kill, a test that kills
// its harness), the server is reparented to the user's systemd and keeps
// running with no client: about 250 MB each, found alive a day later. The
// harness now closes it on every exit it can see; this sweep covers the rest.
//
// A process is stopped only when all of these hold:
// - its argv is exactly what the OpenCode SDK spawns,
// - its environment carries an omg.dev session token, so it was configured by
//   one of our harnesses and not started by a person,
// - its parent is not an OpenCode harness.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SDK_ARGV = ["serve", "--hostname=127.0.0.1", "--port=0"];
const HARNESS_MARK = "opencode-aisdk-session";
const OMG_CONFIG_MARK = "x-omg-session-token";

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function parentPid(stat: string): number | null {
  // comm can hold spaces and parens; the fields after the LAST ") " are fixed.
  const rest = stat.slice(stat.lastIndexOf(") ") + 2).split(" ");
  const ppid = Number(rest[1]);
  return Number.isInteger(ppid) ? ppid : null;
}

export function findOrphanOpencodeServers(procRoot = "/proc"): number[] {
  const orphans: number[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(procRoot);
  } catch {
    return orphans;
  }
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    const dir = join(procRoot, name);
    const cmdline = readText(join(dir, "cmdline"));
    if (!cmdline) continue;
    const argv = cmdline.split("\0").filter(Boolean);
    const program = argv[0]?.split("/").pop() ?? "";
    if (program !== "opencode" || argv.slice(1).join(" ") !== SDK_ARGV.join(" ")) continue;
    const environ = readText(join(dir, "environ"));
    if (!environ?.split("\0").some((line) => line.startsWith("OPENCODE_CONFIG_CONTENT=") && line.includes(OMG_CONFIG_MARK))) continue;
    const stat = readText(join(dir, "stat"));
    const ppid = stat ? parentPid(stat) : null;
    if (ppid == null) continue;
    const parentCmd = readText(join(procRoot, String(ppid), "cmdline")) ?? "";
    if (parentCmd.includes(HARNESS_MARK)) continue;
    orphans.push(Number(name));
  }
  return orphans;
}

export function reapOrphanOpencodeServers(
  procRoot = "/proc",
  kill: (pid: number, signal: NodeJS.Signals) => unknown = process.kill,
): number[] {
  const stopped: number[] = [];
  for (const pid of findOrphanOpencodeServers(procRoot)) {
    try {
      kill(pid, "SIGTERM");
      stopped.push(pid);
    } catch {}
  }
  return stopped;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Sweep a minute after start, then every 10 minutes. */
export function startOrphanAgentServerSweep(onLog: (line: string) => void = () => {}): void {
  if (process.platform !== "linux" || timer) return;
  const run = () => {
    try {
      const stopped = reapOrphanOpencodeServers();
      if (stopped.length) onLog(`[orphan-sweep] stopped ${stopped.length} opencode server(s) with no harness: ${stopped.join(",")}`);
    } catch (error) {
      onLog(`[orphan-sweep] error: ${error}`);
    }
  };
  timer = setInterval(run, 10 * 60_000);
  (timer as { unref?: () => void }).unref?.();
  const first = setTimeout(run, 60_000);
  (first as { unref?: () => void }).unref?.();
}
