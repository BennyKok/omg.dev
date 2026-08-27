/**
 * Sessions that have ENDED, and can be picked up again.
 *
 * The home list only ever showed what is running right now, which is the wrong
 * half of the day. An agent that finished — shipped its work, posted its
 * summary and closed — vanished from the phone completely: the transcript you
 * wanted to read on the way home, and the follow-up you wanted to send, were
 * both unreachable unless you happened to still have the session open. The web
 * has had "Recent sessions" for exactly this reason; the phone had nothing.
 *
 * `/api/sessions/resumable` is that list, and the machine already excludes
 * anything currently live, so a session appears in exactly one of the two
 * sections and never in both.
 *
 * RESUMING IS NOT REOPENING. Reading the transcript costs nothing — the history
 * is in the machine's store whether or not an agent is attached. Resuming
 * COLD-STARTS an agent process and is gated by the same cap as creating one, so
 * it is deliberately not what tapping a row does; see the composer in
 * app/session/[id].tsx, where sending the first message is what asks for it.
 */

import { useCallback, useEffect, useState } from "react";

import { useOmg } from "./provider";

export type ResumableSession = {
  sessionId: string;
  title?: string | null;
  lastUserText?: string | null;
  agent?: string | null;
  project?: string | null;
  cwd?: string | null;
  lastActivityAt?: number | null;
  model?: string | null;
};

export function useResumable(limit = 20): {
  sessions: ResumableSession[];
  loading: boolean;
  refresh: () => void;
} {
  const { client, bindingId } = useOmg();
  const [sessions, setSessions] = useState<ResumableSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  // A machine switch invalidates the list outright: these are that box's
  // sessions, and showing the previous one's rows would offer to resume
  // something this machine has never heard of.
  useEffect(() => {
    setSessions([]);
  }, [bindingId]);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    setLoading(true);
    client.transport
      .request<{ sessions?: ResumableSession[] }>(
        `/api/sessions/resumable?limit=${encodeURIComponent(String(limit))}`,
      )
      .then((payload) => {
        if (!cancelled) setSessions(payload.sessions ?? []);
      })
      .catch(() => {
        // An older machine has no such endpoint. No section, rather than an
        // error on the screen someone opened to see what is running.
        if (!cancelled) setSessions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, limit, tick]);

  return { sessions, loading, refresh };
}
