// Archiving agents that have gone quiet for a long time.
//
// The admission cap stops the box taking on MORE than it can hold; it does
// nothing about what is already resident. A session someone opened on Tuesday
// and stopped replying to still holds its harness, backend and MCP servers —
// 300-500 MB — for as long as the process lives, and nothing ever reclaims it.
// That is how this box reached 21 GB used with almost every session idle.
//
// "Archive" is deliberately not "kill": closeLiveSession persists the resume
// record first, so an archived session reopens where it left off. The cost of a
// wrong decision here is therefore a resume, not lost work — which is what makes
// it safe to do on a timer at all.
//
// The selection is a pure function so the policy can be tested without spawning
// or killing anything.
//
// Memory-pressure reclaim (memoryReclaimCandidates, below) is the second reaper
// and lives here for one reason: two reapers in two files disagreed about what
// is exempt, and the one that forgot won. See its own comment.
import { usesCommandFileRuntime, type CodingAgentTransport } from "./coding-agent-adapters.ts";

export type IdleArchiveCandidate = {
  sessionId: string | null;
  managed: boolean;
  busy?: boolean;
  launching?: boolean;
  persistent?: boolean;
  lastActivityAt: number | null;
  startedAt: number | null;
};

export type IdleArchiveOptions = {
  now: number;
  /** Idle time before a session is eligible. 0 disables archiving entirely. */
  idleMs: number;
  /** Never archive more than this many in one pass. */
  limit?: number;
};

/** Default idle window before an unattended agent is archived. */
export const DEFAULT_IDLE_ARCHIVE_MINUTES = 0;
/** Guard rail: below this, a brief pause between turns would archive live work. */
export const MIN_IDLE_ARCHIVE_MINUTES = 15;
export const MAX_IDLE_ARCHIVE_MINUTES = 7 * 24 * 60;

/** How long a session has been silent, or null when that cannot be established. */
export function idleMsFor(
  session: Pick<IdleArchiveCandidate, "lastActivityAt" | "startedAt">,
  now: number,
): number | null {
  // startedAt is the fallback for a session that never produced a turn: it has
  // still been resident that whole time, and is if anything MORE abandoned than
  // one that at least said something.
  const since = session.lastActivityAt ?? session.startedAt;
  if (since == null || !Number.isFinite(since)) return null;
  return Math.max(0, now - since);
}

/**
 * Sessions eligible for idle archiving, longest-idle first.
 *
 * Excluded, in order of how badly getting it wrong would hurt:
 *  - `busy`: a turn is in flight. Archiving mid-turn discards the work.
 *  - `launching`: it has not finished starting; its activity clock is not yet
 *    meaningful and it would be archived for the crime of being new.
 *  - unmanaged: a human's own tmux session is not ours to close.
 *  - no sessionId: nothing to persist a resume record against, so "archive"
 *    would just be "kill".
 *  - unknown idle time: never archive on a guess.
 */
export function idleArchiveCandidates<T extends IdleArchiveCandidate>(
  sessions: readonly T[],
  options: IdleArchiveOptions,
): T[] {
  if (!(options.idleMs > 0)) return [];
  const eligible = sessions.filter((session) => {
    if (!session.managed || !session.sessionId) return false;
    if (session.persistent) return false;
    if (session.busy || session.launching) return false;
    const idle = idleMsFor(session, options.now);
    return idle != null && idle >= options.idleMs;
  });
  eligible.sort((a, b) => (idleMsFor(b, options.now) ?? 0) - (idleMsFor(a, options.now) ?? 0));
  return options.limit != null ? eligible.slice(0, options.limit) : eligible;
}

export type MemoryReclaimCandidate = Omit<IdleArchiveCandidate, "lastActivityAt" | "startedAt"> & {
  agent?: string | null;
  runtime?: CodingAgentTransport | null;
  lastActivityAt?: number | null;
  startedAt?: number | null;
};

/**
 * Durable harnesses a memory-pressure launch may reclaim, oldest first.
 *
 * Same exemptions as idle archiving, for the same reasons — plus the one that
 * was missing here and only here: `persistent`. A bot's backing session is idle
 * between turns by definition, which made it the oldest candidate in this list
 * and let any unrelated launch reclaim it. Archiving is normally cheap because
 * a session resumes where it left off, but a bot relaunch mints a fresh session
 * id, so the human's chat with that bot came back empty.
 *
 * Only command-file harnesses qualify: a process-bound (tmux) session has no
 * resume record to archive against, so reclaiming it would be a kill.
 */
export function memoryReclaimCandidates<T extends MemoryReclaimCandidate>(
  sessions: readonly T[],
): T[] {
  return sessions
    .filter(
      (session) =>
        !!session.sessionId &&
        session.managed &&
        !session.persistent &&
        !session.busy &&
        !session.launching &&
        usesCommandFileRuntime(session.agent, session.runtime),
    )
    .sort(
      (a, b) =>
        (a.lastActivityAt ?? a.startedAt ?? 0) - (b.lastActivityAt ?? b.startedAt ?? 0),
    );
}

/** Clamp a user-supplied idle window, where 0 means "off". */
export function sanitizeIdleArchiveMinutes(value: unknown): number {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes <= 0) return 0;
  return Math.min(Math.max(minutes, MIN_IDLE_ARCHIVE_MINUTES), MAX_IDLE_ARCHIVE_MINUTES);
}
