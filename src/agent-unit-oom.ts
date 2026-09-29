// Did the kernel OOM killer end a contained harness?
//
// A contained harness runs as the transient user unit lfg-agent-<tmuxName>
// (containedAgentCommand in tmux.ts: MemoryMax, KillMode=control-group). The
// unit is started with --collect, so once it fails systemd unloads it and
// `systemctl --user show` reports LoadState=not-found, Result=success. The
// user journal keeps the evidence:
//
//   lfg-agent-lfg-437797.service: The kernel OOM killer killed some processes in this unit.
//   lfg-agent-lfg-437797.service: Failed with result 'oom-kill'.
//
// So the journal is read, not the unit. listSessions calls this on every
// refresh for each dead contained harness, so the answer is cached per
// harness: one journalctl per dead process per serve lifetime.

export function agentUnitName(tmuxName: string): string {
  return `lfg-agent-${tmuxName}.service`;
}

const OOM_LINE = /Failed with result 'oom-kill'|The kernel OOM killer killed/;

export function journalShowsOomKill(journal: string): boolean {
  return OOM_LINE.test(journal);
}

export type JournalReader = (unit: string, sinceMs: number) => string;

function readUserJournal(unit: string, sinceMs: number): string {
  if (process.platform !== "linux") return "";
  const journalctl = Bun.which("journalctl");
  if (!journalctl) return "";
  try {
    const out = Bun.spawnSync({
      cmd: [
        journalctl, "--user", "-u", unit, "-o", "cat", "--no-pager", "-q",
        "--since", `@${Math.max(0, Math.floor(sinceMs / 1000) - 1)}`,
        // The harness logs to the same unit. The systemd verdict is at the end.
        "-n", "40",
      ],
      stdout: "pipe",
      stderr: "ignore",
      timeout: 2_000,
    });
    return out.stdout ? out.stdout.toString() : "";
  } catch {
    return "";
  }
}

const cache = new Map<string, boolean>();
let reader: JournalReader = readUserJournal;

/**
 * True when the unit's journal, since the harness started, records an OOM
 * kill. `harnessKey` identifies the dead process (pid plus start time) so a
 * relaunch in the same unit is asked again.
 */
export function agentUnitOomKilled(unit: string, sinceMs: number, harnessKey: string): boolean {
  const key = `${unit}:${harnessKey}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const killed = journalShowsOomKill(reader(unit, sinceMs));
  cache.set(key, killed);
  return killed;
}

export function setJournalReaderForTests(next: JournalReader | null): void {
  reader = next ?? readUserJournal;
  cache.clear();
}
