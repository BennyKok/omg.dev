/**
 * "This session finished and you have not looked at it yet."
 *
 * The list could draw a session working, and it could draw nothing. Nothing
 * meant three things at once — finished a second ago, finished and read, done
 * last March — so the state a person actually waits for was the one state the
 * list had no mark for.
 *
 * READ STATE IS THE SERVER'S. `src/session-reads.ts` holds a per-person
 * watermark against the transcript index, `/api/sessions?user=<identity>`
 * stamps `unread` on each row, and `POST /api/sessions/:id/read` advances the
 * mark. Nothing here persists anything on the device; this module is the
 * client's half, kept pure so it can be tested without Metro (see
 * src/mobile-session-unread.test.ts).
 *
 * This is the same contract as web/src/lib/session-unread.ts, on purpose: one
 * question must not get two answers on two surfaces. Notably, unread lives in
 * its OWN SET rather than on the session rows. The list is also written by live
 * status frames and by optimistic local edits, and those writers build rows
 * without ever having seen a watermark; carrying the flag on the row made it
 * blink off on the next such write. The set is only ever replaced by a full
 * list payload, which is the only thing that knows.
 *
 * Working and unread stay two facts. A session can be busy again and still
 * hold a reply you never read.
 */

/** A row of `/api/sessions`, narrowed to the two fields read state needs. */
export type UnreadSessionRow = { sessionId?: string | null; unread?: boolean };

/**
 * The session-list path for the viewer whose watermark we also write.
 *
 * Without the viewer the box answers for whatever identity it resolves from
 * the request, which is a DIFFERENT watermark than the one "mark read" writes,
 * and the two answers then take turns on every poll.
 */
export function sessionListUrlForViewer(identity: string | null | undefined): string {
  return identity ? `/api/sessions?user=${encodeURIComponent(identity)}` : "/api/sessions";
}

/** The unread ids in a `/api/sessions` payload. */
export function unreadSessionIds(sessions: readonly UnreadSessionRow[]): Set<string> {
  const out = new Set<string>();
  for (const session of sessions) {
    if (session.unread && session.sessionId) out.add(session.sessionId);
  }
  return out;
}

/**
 * Drop one session from the unread set without waiting for the server.
 *
 * Returns the SAME set when there was nothing to clear, so opening an
 * already-read session does not produce a new identity and re-render every row
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
 * thing. Replacing the set anyway would re-render every row of the list on a
 * timer, which is the cost this check exists to avoid.
 */
export function sameUnreadSessions(a: Set<string>, b: Set<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** Just the part of the SDK transport a list fetch needs. */
export type SessionListTransport = {
  request<T>(path: string, init?: RequestInit): Promise<T>;
};

/**
 * Fetch the session list AS A NAMED VIEWER, and harvest the unread set from it.
 *
 * `stillCurrent` is the whole reason this is a function rather than two lines
 * at the call site. The list is refetched on focus, on a timer, on a finished
 * turn, and on every machine or account change, so a slow answer for the
 * machine (or the person) you just switched AWAY from can land after the
 * switch. Its rows are stale and its read state belongs to somebody else's
 * watermark, so the unread set must not take it. The rows are still returned:
 * what the list does with them is the caller's own guard to make, and this
 * function must not silently swallow a payload.
 */
export async function fetchSessionsForViewer<T extends UnreadSessionRow>(options: {
  transport: SessionListTransport;
  viewer: string | null | undefined;
  /** False once the answer belongs to a machine or a person nobody is on any more. */
  stillCurrent: () => boolean;
  onUnread: (unread: Set<string>) => void;
}): Promise<T[]> {
  const payload = await options.transport.request<{ sessions?: T[] }>(
    sessionListUrlForViewer(options.viewer),
    { cache: "no-store" },
  );
  const rows = Array.isArray(payload.sessions) ? payload.sessions : [];
  if (options.stillCurrent()) options.onUnread(unreadSessionIds(rows));
  return rows;
}

/** The write that advances this viewer's watermark for one session. */
export function markSessionReadPath(sessionId: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/read`;
}

/** Just the part of the SDK transport this write needs. */
export type SessionReadTransport = {
  request<T>(path: string, init?: RequestInit): Promise<T>;
};

/**
 * Tell the box this session has been read, through its newest assistant turn.
 *
 * NEVER AWAITED IN FRONT OF A PAINT. Clearing the dot is local (see
 * `clearSessionUnread`); this write only makes the next list payload agree.
 * It resolves false on failure rather than throwing, because a dropped
 * acknowledgement is not worth an error banner: the row simply stays unread
 * and the next open tries again.
 */
export async function markSessionRead(
  transport: SessionReadTransport,
  sessionId: string,
  viewer: string | null | undefined,
): Promise<boolean> {
  try {
    await transport.request(markSessionReadPath(sessionId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: viewer ?? "" }),
    });
    return true;
  } catch {
    return false;
  }
}
