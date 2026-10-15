import { usesCommandFileRuntime } from "./coding-agent-adapters.ts";
import { listManaged, patchManaged, type ManagedSession } from "./managed.ts";
import { NO_PROJECT } from "./no-project-chat.ts";
import type { RepoEntry } from "./repo-resolve.ts";
import { moveCommandFileSession, sessionIsMoving } from "./session-recovery.ts";

/**
 * A chat with no project that creates one with omg_create_project moves into
 * it. The agent is mid-turn when it calls the tool, and a move restarts the
 * harness, so the request is recorded on the owner row and applied at the
 * next idle boundary by applyPendingProjectMoves. moveCommandFileSession stays
 * the only code that changes a live session's folder.
 */
export type ProjectSessionMove =
  | { status: "after_turn"; cwd: string; project: string }
  | { status: "not_moved"; reason: string };

function ownerFor(callerId: string, rows: ManagedSession[]): ManagedSession | undefined {
  return rows.find((row) => row.sessionId === callerId || row.nativeSessionId === callerId);
}

export function requestProjectSessionMove(
  callerId: string | null | undefined,
  repo: RepoEntry,
  now = Date.now(),
): ProjectSessionMove | null {
  const id = callerId?.trim();
  if (!id) return null;
  const owner = ownerFor(id, listManaged());
  if (!owner) return null;
  if (owner.project !== NO_PROJECT)
    return { status: "not_moved", reason: "This chat already belongs to a project" };
  if (owner.botId || owner.persistent)
    return { status: "not_moved", reason: "A bot keeps its configured folder" };
  if (!usesCommandFileRuntime(owner.agent, owner.runtime))
    return { status: "not_moved", reason: "This agent cannot move an existing chat between folders" };
  patchManaged(owner.tmuxName, {
    pendingProjectMove: { cwd: repo.cwd, project: repo.project, requestedAt: now },
  });
  return { status: "after_turn", cwd: repo.cwd, project: repo.project };
}

export type PendingMoveDeps = {
  /** True while the agent runs a turn or messages wait to be delivered. */
  isBusy: (sessionId: string) => Promise<boolean>;
  move?: typeof moveCommandFileSession;
  log?: (message: string) => void;
};

/** Apply each recorded move once its session is idle. Returns moves applied. */
export async function applyPendingProjectMoves(deps: PendingMoveDeps): Promise<number> {
  const move = deps.move ?? moveCommandFileSession;
  const log = deps.log ?? ((message: string) => console.log(message));
  let moved = 0;
  for (const row of listManaged()) {
    const pending = row.pendingProjectMove;
    const sessionId = row.sessionId ?? row.nativeSessionId;
    if (!pending || !sessionId) continue;
    // The user may move or relabel the chat before the turn ends. Their
    // choice wins over the agent's earlier request.
    if (row.project !== NO_PROJECT) {
      patchManaged(row.tmuxName, { pendingProjectMove: undefined });
      continue;
    }
    if (row.launchState === "launching" || sessionIsMoving(sessionId) || await deps.isBusy(sessionId)) continue;
    const result = await move(sessionId, {
      cwd: pending.cwd,
      project: pending.project,
      repoRoot: pending.cwd,
    });
    // 409 means "not now": a message arrived, or the harness must be resumed
    // first. Keep the request for the next idle boundary. Any other failure
    // already restored the original folder, so the chat stays usable in
    // Quick Chat and the user can move it by hand.
    if (!result.ok && result.status === 409) continue;
    patchManaged(row.tmuxName, { pendingProjectMove: undefined });
    if (result.ok) {
      moved++;
      log(`[project-move] moved ${sessionId} into ${pending.project} (${pending.cwd})`);
    } else {
      log(`[project-move] could not move ${sessionId} into ${pending.project}: ${result.error}`);
    }
  }
  return moved;
}
