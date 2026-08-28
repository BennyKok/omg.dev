/**
 * "This chat finished and you have not looked at it yet."
 *
 * The roster could draw a session working, and it could draw nothing. Nothing
 * meant three things at once — finished a second ago, finished and read, done
 * last March — so the state a person actually waits for was the one state the
 * list had no mark for.
 *
 * Read state is the server's: `src/session-reads.ts` holds a per-person
 * watermark against the transcript index, and `/api/sessions` stamps `unread`
 * on each row. This module is the client's half, kept pure so it can be tested
 * without mounting the roster.
 *
 * Unread lives in its own set rather than on the session objects. The fleet
 * list is also written by live events and by optimistic local edits, and those
 * writers build rows without ever having seen a read watermark; carrying the
 * flag on the row made it blink off on the next such write. The set is only
 * ever replaced by a full list payload, which is the only thing that knows.
 *
 * Working and unread stay two facts, the same way the bot roster keeps them
 * apart. A session can be busy again and still hold a reply you never read.
 */

export type UnreadSessionRow = { sessionId?: string | null; unread?: boolean };

/** The session-list endpoint for the same viewer whose watermark we write. */
export function sessionListUrlForViewer(identity: string): string {
  return `/api/sessions?user=${encodeURIComponent(identity)}`;
}

/** The unread ids in a `/api/sessions` payload. */
export function unreadSessionIds(sessions: UnreadSessionRow[]): Set<string> {
  const out = new Set<string>();
  for (const session of sessions) {
    if (session.unread && session.sessionId) out.add(session.sessionId);
  }
  return out;
}

/**
 * Drop one session from the unread set without waiting for the server.
 *
 * Returns the same set when there was nothing to clear, so opening an
 * already-read session does not produce a new identity and re-run every effect
 * that keys on it.
 */
export function clearSessionUnread(unread: Set<string>, sessionId: string): Set<string> {
  if (!unread.has(sessionId)) return unread;
  const next = new Set(unread);
  next.delete(sessionId);
  return next;
}

/**
 * Two sets are equal when they hold the same ids.
 *
 * The list is refetched every few seconds and almost always says the same
 * thing. Replacing the set anyway would re-render every row of the roster on a
 * timer, which is the cost this check exists to avoid.
 */
export function sameUnreadSessions(a: Set<string>, b: Set<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/**
 * A complete row label. Read state must not be communicated by colour alone,
 * which is the rule the bot roster's own label already follows.
 */
export function sessionRosterRowAriaLabel(input: {
  title: string;
  working: boolean;
  unread: boolean;
  blocked?: boolean;
}): string {
  const activity = input.blocked ? "paused" : input.working ? "working" : "idle";
  return `${input.title}, ${activity}, ${input.unread ? "unread" : "read"}`;
}

/** The collapsed rail shows only the mark, so its tooltip has to carry the state. */
export function sessionRosterTooltip(title: string, unread: boolean): string {
  return unread ? `${title} · unread` : title;
}
