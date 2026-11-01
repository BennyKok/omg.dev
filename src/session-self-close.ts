import { listManaged, patchManaged, type ManagedSession } from "./managed.ts";
import { sessionIsMoving } from "./session-recovery.ts";

/**
 * A session can close itself with omg_close_session. The agent is mid tool
 * call when it asks, and closing on the spot would kill it before the tool
 * result reaches it and before it writes its last reply. So the request is
 * recorded on the owner row and applied at the next idle boundary by
 * applyPendingSelfCloses, the same shape as a pending project move.
 * closeLiveSession stays the only teardown path.
 *
 * The server decides "self" from the caller header, not the MCP client, so a
 * short id, a native id, or an omitted id all resolve to the same answer.
 */
export type SelfCloseRequest = { status: "after_turn" } | { status: "refused"; reason: string };

/** Lets the tool result and the final reply start before the first idle check. */
export const SELF_CLOSE_GRACE_MS = 3_000;
/** A turn that never goes idle drops the request and leaves the session open. */
export const SELF_CLOSE_MAX_WAIT_MS = 10 * 60_000;

function matches(row: ManagedSession, id: string): boolean {
  return row.sessionId === id || row.nativeSessionId === id;
}

/**
 * Record a close for the caller's own session. Returns null when the caller
 * is not the target, so the route closes the target right away as before.
 */
export function requestSelfClose(
  callerId: string | null | undefined,
  targetId: string,
  now = Date.now(),
): SelfCloseRequest | null {
  const caller = callerId?.trim();
  if (!caller) return null;
  const owner = listManaged().find((row) => matches(row, caller));
  if (!owner || !matches(owner, targetId)) return null;
  if (owner.botId || owner.persistent) return { status: "refused", reason: "A bot conversation cannot close itself" };
  patchManaged(owner.tmuxName, { pendingSelfClose: { requestedAt: now } });
  return { status: "after_turn" };
}

/**
 * A message from the person after the request wins over it: they want the
 * session to keep going. Returns true when a pending close was dropped.
 */
export function cancelSelfClose(tmuxName: string | null | undefined): boolean {
  if (!tmuxName) return false;
  const row = listManaged().find((r) => r.tmuxName === tmuxName);
  if (!row?.pendingSelfClose) return false;
  patchManaged(tmuxName, { pendingSelfClose: undefined });
  return true;
}

export type PendingSelfCloseDeps = {
  /** True while a turn runs or messages wait; null when the session is not live. */
  isBusy: (sessionId: string) => Promise<boolean | null>;
  close: (sessionId: string) => Promise<{ ok: boolean; reason?: string }>;
  now?: () => number;
  log?: (message: string) => void;
};

/** Close each session that asked to close itself, once its turn has ended. */
export async function applyPendingSelfCloses(deps: PendingSelfCloseDeps): Promise<number> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((message: string) => console.log(message));
  let closed = 0;
  for (const row of listManaged()) {
    const pending = row.pendingSelfClose;
    const sessionId = row.sessionId ?? row.nativeSessionId;
    if (!pending) continue;
    if (!sessionId) {
      patchManaged(row.tmuxName, { pendingSelfClose: undefined });
      continue;
    }
    const age = now() - pending.requestedAt;
    if (age < SELF_CLOSE_GRACE_MS) continue;
    if (age > SELF_CLOSE_MAX_WAIT_MS) {
      patchManaged(row.tmuxName, { pendingSelfClose: undefined });
      log(`[self-close] ${sessionId} never went idle; left open`);
      continue;
    }
    if (row.launchState === "launching" || sessionIsMoving(sessionId)) continue;
    const busy = await deps.isBusy(sessionId);
    if (busy) continue;
    // Clear first: some teardown paths keep the row, and a failed close must
    // not retry forever.
    patchManaged(row.tmuxName, { pendingSelfClose: undefined });
    if (busy === null) continue;
    const result = await deps.close(sessionId);
    if (result.ok) {
      closed++;
      log(`[self-close] closed ${sessionId} after its turn`);
    } else {
      log(`[self-close] could not close ${sessionId}: ${result.reason ?? "unknown"}`);
    }
  }
  return closed;
}
