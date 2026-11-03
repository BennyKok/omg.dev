import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "./config.ts";

function sessionDirectory(sessionId: string): string {
  return join(PATHS.data, "session-mcp", createHash("sha256").update(sessionId).digest("hex"));
}

/** A separate file per query prevents concurrent runs from replacing credentials. */
export function claudeMcpConfigFile(sessionId: string, config: { mcpServers?: unknown }) {
  if (!config.mcpServers) return { options: {}, [Symbol.dispose]() {} };
  const directory = sessionDirectory(sessionId);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const run = mkdtempSync(join(directory, `run-${process.pid}-`));
  const path = join(run, "mcp.json");
  try {
    writeFileSync(path, JSON.stringify(config), { mode: 0o600, flag: "wx" });
  } catch (error) {
    rmSync(run, { recursive: true, force: true });
    throw error;
  }
  const cleanup = () => {
    rmSync(run, { recursive: true, force: true });
    process.off("exit", cleanup);
  };
  process.once("exit", cleanup);
  // Do not also pass mcpServers: the SDK serializes that option into argv.
  return { options: { extraArgs: { "mcp-config": path } }, [Symbol.dispose]: cleanup };
}

/** The session lifecycle owner also removes files after a forced harness stop. */
export function cleanupSessionMcpConfigs(sessionId: string): void {
  rmSync(sessionDirectory(sessionId), { recursive: true, force: true });
}

function ownerAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

/** The existing orphan sweep covers SIGKILL/OOM/reboot, where no exit handler
 * can run. Keep files for a live PID (including a reused PID) conservatively.
 */
export function reapOrphanMcpConfigs(isAlive: (pid: number) => boolean = ownerAlive): number {
  const root = join(PATHS.data, "session-mcp");
  let sessions: string[];
  try { sessions = readdirSync(root); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; }
  let removed = 0;
  for (const session of sessions) {
    if (typeof session !== "string" || !/^[a-f0-9]{64}$/.test(session)) continue;
    const directory = join(root, session);
    let runs: string[];
    try { runs = readdirSync(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    for (const run of runs) {
      const match = /^run-([1-9][0-9]*)-[A-Za-z0-9]+$/.exec(run);
      if (!match || isAlive(Number(match[1]))) continue;
      rmSync(join(directory, run), { recursive: true, force: true });
      removed++;
    }
  }
  return removed;
}
