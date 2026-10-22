import { useEffect, useRef, useState } from "react";

/**
 * How long the open session may be missing from the live list before its page
 * asks the server again and, if the session is still missing, closes.
 *
 * A chat that creates a project moves into it at its next idle moment
 * (src/project-session-move.ts). The move stops the agent and starts it again
 * in the new folder, and no list names the session until the new agent has
 * registered: up to 4 s to stop and 10 s to start. Closing on that gap sent
 * a person on a phone back to Create while their app was being published
 * (live test, 2026-10-22).
 */
export const OPEN_SESSION_GONE_GRACE_MS = 15_000;

type SessionRow = { sessionId?: string | null };

/**
 * The session `/sessions/<id>` names, looked up by id.
 *
 * The page is keyed by the session id in the URL, not by membership in a
 * filtered list. A project, folder, title or owner change does not close it.
 * While the session is missing from the live list, the last row seen for that
 * id stays on screen. The page closes only when the session is still missing
 * after the grace period and a fresh read of the list (`onRefresh`).
 *
 * `liveSessions` is every live session, before any user or project filter.
 * `shippedReview` is a finished session opened from Shipped, which is not live.
 */
export function useOpenSession<S extends SessionRow>({
  openSessionId,
  liveSessions,
  shippedReview,
  onRefresh,
  onClose,
  graceMs = OPEN_SESSION_GONE_GRACE_MS,
}: {
  openSessionId: string | null;
  liveSessions: readonly S[];
  shippedReview?: S | null;
  onRefresh: () => Promise<void>;
  onClose?: () => void;
  graceMs?: number;
}): S | null {
  const live = openSessionId
    ? liveSessions.find((session) => session.sessionId === openSessionId) ??
      (shippedReview?.sessionId === openSessionId ? shippedReview : null)
    : null;

  // Hold the last row for the open id, so a short absence does not unmount
  // the page under the person reading it.
  const lastRef = useRef<S | null>(null);
  if (live) lastRef.current = live;
  else if (lastRef.current?.sessionId !== openSessionId) lastRef.current = null;

  // Only once a list has actually arrived. An empty list is the boot state as
  // well as the "nothing is running" state, and treating the first as the
  // second bounced every cold deep link straight back to the list.
  const sessionsSeenRef = useRef(false);
  if (liveSessions.length) sessionsSeenRef.current = true;

  const missing = !!openSessionId && !live;
  // The id whose absence a fresh list read has confirmed. Set after the
  // refresh resolves, so the render that sees it also sees that list.
  const [confirmedGone, setConfirmedGone] = useState<string | null>(null);

  useEffect(() => {
    if (!missing || !openSessionId || !sessionsSeenRef.current) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void onRefresh()
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setConfirmedGone(openSessionId);
        });
    }, graceMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [missing, openSessionId, onRefresh, graceMs]);

  useEffect(() => {
    if (!confirmedGone) return;
    if (missing && confirmedGone === openSessionId) onClose?.();
    setConfirmedGone(null);
  }, [confirmedGone, missing, openSessionId, onClose]);

  return live ?? lastRef.current;
}
