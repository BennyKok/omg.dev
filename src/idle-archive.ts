// Reclaiming durable command-file harnesses under memory pressure.
//
// The admission cap stops the box taking on MORE than it can hold; it does
// nothing about what is already resident. A session someone opened on Tuesday
// and stopped replying to still holds its harness, backend and MCP servers —
// 300-500 MB — for as long as the process lives, and nothing reclaims it on
// its own. That is how this box reached 21 GB used with almost every session
// idle.
//
// There used to be a second, timer-driven reaper in this file for exactly
// that steady-state case (Settings' "Archive idle agents", alongside "Pause
// new agents"). Benny had it removed entirely rather than just hidden — an
// off switch nobody using the box could see was worse than no switch — so
// this file now covers only the memory-pressure path below.
//
// "Reclaim" is deliberately not "kill": closeLiveSession persists the resume
// record first, so a reclaimed session reopens where it left off. The cost of
// a wrong decision here is therefore a resume, not lost work.
//
// The selection is a pure function so the policy can be tested without
// spawning or killing anything.
import { usesCommandFileRuntime, type CodingAgentTransport } from "./coding-agent-adapters.ts";

export type MemoryReclaimCandidate = {
  sessionId: string | null;
  managed: boolean;
  busy?: boolean;
  launching?: boolean;
  persistent?: boolean;
  agent?: string | null;
  runtime?: CodingAgentTransport | null;
  lastActivityAt?: number | null;
  startedAt?: number | null;
};

/**
 * Durable harnesses a memory-pressure launch may reclaim, oldest first.
 *
 * Exemptions, in order of how badly getting one wrong would hurt:
 *  - `busy`: a turn is in flight. Reclaiming mid-turn discards the work.
 *  - `launching`: it has not finished starting; its activity clock is not yet
 *    meaningful and it would be reclaimed for the crime of being new.
 *  - unmanaged: a human's own tmux session is not ours to close.
 *  - no sessionId: nothing to persist a resume record against, so "reclaim"
 *    would just be "kill".
 *  - `persistent`: a bot's backing session is idle between turns by
 *    definition, which would otherwise sort it to the front of this list and
 *    let any unrelated launch reclaim it. A bot relaunch mints a fresh
 *    session id, so the human's chat history with that bot would come back
 *    empty — worse than the resume an ordinary reclaim gives.
 *
 * Only command-file harnesses qualify: a process-bound (tmux) session has no
 * resume record to reclaim against, so reclaiming it would be a kill.
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
