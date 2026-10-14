/**
 * What an install or update run of coding agents ended as, in words.
 *
 * The server owns the run and records `setupResult` per agent when it ends
 * (src/coding-agents.ts). The client only remembers which agents it started
 * and their version at that moment, so the final message can say whether the
 * version actually moved.
 */

export type SetupResultInfo = {
  action: "install" | "update";
  ok: boolean;
  error?: string;
  finishedAt: number;
};

export type SetupWatchAgent = {
  key: string;
  label: string;
  /** Version shown before the run started. */
  fromVersion?: string;
};

export type SetupWatchStatus = {
  key: string;
  status: { setupRunning: boolean; version?: string; setupResult?: SetupResultInfo };
};

export type SetupOutcome = {
  ok: boolean;
  title: string;
  description?: string;
};

/** One line for one finished agent. */
export function setupOutcomeLine(
  label: string,
  result: SetupResultInfo | undefined,
  fromVersion: string | undefined,
  toVersion: string | undefined,
): string {
  if (result && !result.ok) {
    return `${label} ${result.action === "install" ? "install" : "update"} failed`;
  }
  if (result?.action === "install") return toVersion ? `${label} installed (v${toVersion})` : `${label} installed`;
  if (toVersion && fromVersion && toVersion !== fromVersion) {
    return `${label} updated from v${fromVersion} to v${toVersion}`;
  }
  if (toVersion && fromVersion === toVersion) return `${label} is up to date (v${toVersion})`;
  return toVersion ? `${label} updated to v${toVersion}` : `${label} updated`;
}

/**
 * Null while any watched agent is still running. Otherwise one summary for
 * the whole run: a single agent gets its own line, several agents get a count
 * with the per-agent lines in the description.
 */
export function setupOutcome(
  watched: SetupWatchAgent[],
  agents: SetupWatchStatus[],
): SetupOutcome | null {
  const byKey = new Map(agents.map((agent) => [agent.key, agent]));
  if (watched.some((item) => byKey.get(item.key)?.status.setupRunning)) return null;
  const rows = watched.map((item) => {
    const status = byKey.get(item.key)?.status;
    const result = status?.setupResult;
    return {
      ok: result ? result.ok : true,
      line: setupOutcomeLine(item.label, result, item.fromVersion, status?.version),
      error: result && !result.ok ? result.error : undefined,
    };
  });
  const failed = rows.filter((row) => !row.ok);
  if (rows.length === 1) {
    const row = rows[0]!;
    return { ok: row.ok, title: row.line, ...(row.error ? { description: row.error } : {}) };
  }
  const title = failed.length
    ? `${failed.length} of ${rows.length} agents failed to update`
    : `${rows.length} agents updated`;
  return { ok: failed.length === 0, title, description: rows.map((row) => row.line).join("\n") };
}

/** A finished run stays on its row for this long, then the row goes quiet. */
export const SETUP_RESULT_VISIBLE_MS = 10 * 60 * 1000;

/** The collapsed row's note for a run that is going on or just ended. */
export function setupRowNote(
  status: {
    setupRunning: boolean;
    setupProgress?: { percent: number; label: string };
    setupResult?: SetupResultInfo;
    version?: string;
  },
  now = Date.now(),
): { text: string; tone: "progress" | "success" | "error" } | null {
  if (status.setupRunning) {
    return { text: status.setupProgress?.label ?? "Starting…", tone: "progress" };
  }
  const result = status.setupResult;
  if (!result || now - result.finishedAt > SETUP_RESULT_VISIBLE_MS) return null;
  const verb = result.action === "install" ? "Installed" : "Updated";
  if (!result.ok) return { text: `${result.action === "install" ? "Install" : "Update"} failed`, tone: "error" };
  return { text: status.version ? `${verb} · v${status.version}` : verb, tone: "success" };
}
