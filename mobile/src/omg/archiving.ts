/**
 * SESSIONS BEING ARCHIVED, shared by every screen that can archive one.
 *
 * Archiving is `POST /api/sessions/:id/close`, and the answer is not instant:
 * the machine stops the agent before it replies. Two things went wrong while
 * that request was in the air:
 *
 * - The session screen's Archive waited for the answer before going back, so
 *   the person watched the chat they had just archived until the server
 *   replied.
 * - Home removed a swiped row locally, but any list refresh that landed
 *   before the close finished returned the session and drew the row again.
 *
 * One set of ids fixes both. Home leaves these ids out of every list it
 * draws, whatever a refresh returns. An id leaves the set when the close
 * fails (the row comes back) or when a fresh list no longer carries it (the
 * machine has caught up), so the set cannot hide a live session for good.
 */
import { useSyncExternalStore } from "react";

let archiving: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function publish(next: ReadonlySet<string>) {
  archiving = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function archivingSessionIds(): ReadonlySet<string> {
  return archiving;
}

/** The ids Home must not draw right now. */
export function useArchivingSessionIds(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, archivingSessionIds, archivingSessionIds);
}

/**
 * A close the machine refused because the session was already gone still did
 * what the person asked. Anything else leaves the session live.
 */
function alreadyGone(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b404\b|not found/i.test(message);
}

/**
 * Hide the session at once, then ask the machine to close it. Resolves when
 * the close is answered. Rejects only when the session is still live, after
 * putting it back.
 */
export async function archiveSession(sessionId: string, close: () => Promise<unknown>): Promise<void> {
  if (!archiving.has(sessionId)) publish(new Set([...archiving, sessionId]));
  try {
    await close();
  } catch (error) {
    if (alreadyGone(error)) return;
    const next = new Set(archiving);
    next.delete(sessionId);
    publish(next);
    throw error;
  }
}

/**
 * Forget ids the machine no longer lists. Called with every fresh list, so
 * the set only ever holds closes the list has not caught up with yet.
 */
export function forgetArchivedSessions(listed: Iterable<string | null | undefined>): void {
  if (!archiving.size) return;
  const present = new Set<string>();
  for (const id of listed) if (id) present.add(id);
  const next = new Set([...archiving].filter((id) => present.has(id)));
  if (next.size !== archiving.size) publish(next);
}

/** Test seam. */
export function resetArchivingForTests(): void {
  publish(new Set());
}
