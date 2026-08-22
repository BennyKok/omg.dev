// Closes the gap dispatchFixAgent (src/client-errors.ts) left open: a fix
// session gets spawned against a finding, but nothing ever wrote the outcome
// back. The concrete case: a #185 client-error finding, fix dispatched, fix
// landed in commit 66732e8 four minutes later — and the finding still read
// "open" two months on, because nothing re-checked it.
//
// Two passes, run off the auto scheduler's existing 60s tick:
//   1. For a finding whose dispatched session (status "session") pushed its
//      work to origin/main, record that — via the SAME git read the ship gate
//      uses to answer "did this session's work actually land"
//      (collectShipProvenance), not by assuming a session that stopped
//      running means it succeeded. It may have failed, been interrupted, or
//      decided no change was needed, so this only records what git says.
//   2. Promote a "fix-landed" finding to "resolved" once it has gone quiet
//      for the grace window. recordRecurrence is what reopens a finding
//      early if the bug comes back; surviving the window still in
//      "fix-landed" is the actual evidence, not the landing by itself.

import { listManaged, type ManagedSession } from "../managed.ts";
import { collectShipProvenance } from "../ship-provenance.ts";
import { listFindings, markFixLanded, promoteLandedFixes, type Finding } from "./store.ts";

function findManagedSession(sessionId: string | undefined): ManagedSession | undefined {
  if (!sessionId) return undefined;
  return listManaged().find((m) => m.sessionId === sessionId);
}

export type FixLandingReconcileResult = {
  landed: Finding[];
  resolved: Finding[];
};

/**
 * Best-effort by design: a session already reaped from the managed registry
 * (worktree garbage-collected, box restarted with no trace) leaves nothing to
 * read git from, so that finding simply stays "session" — we do not invent
 * landing evidence we don't have. In practice the worked #185 case landed
 * within minutes of dispatch, well inside the 60s tick this runs on.
 */
export async function reconcileFixLandings(now = Date.now()): Promise<FixLandingReconcileResult> {
  const landed: Finding[] = [];
  const inFlight = (await listFindings()).filter((f) => f.status === "session" && f.sessionId);

  for (const finding of inFlight) {
    const managed = findManagedSession(finding.sessionId);
    if (!managed) continue;

    const provenance = collectShipProvenance({ cwd: managed.cwd, worktreeBranch: managed.worktreeBranch });
    if (provenance?.state !== "landed") continue;

    const updated = await markFixLanded(finding.id, provenance.head ?? "", now);
    if (updated) landed.push(updated);
  }

  const resolved = await promoteLandedFixes(now);
  return { landed, resolved };
}
