// Which coding sessions have said something you have not read yet.
//
// The roster could show that an agent is working, and it could show nothing at
// all. "Nothing at all" carried three different meanings: finished a moment ago,
// finished and already read, finished last March. So the one state a person
// waits for — this chat landed a turn and I have not looked — was the state the
// list could not draw.
//
// Bots already answer this question, and this answers it the same way: compare
// the newest assistant rowid in `src/transcript-index.ts` against a durable
// per-person watermark. The two halves share `src/read-watermarks.ts`, so read
// state cannot mean one thing on a bot row and another on a session row.
//
// Working and unread stay separate facts. A session can be busy again and still
// hold a reply you never read; one badge for both would overwrite one of them.

import { join } from "node:path";
import { PATHS } from "./config.ts";
import { createReadWatermarkStore, readWatermarkUser } from "./read-watermarks.ts";
import { latestIndexedAssistantRowids, maxIndexedMessageRowid } from "./transcript-index.ts";

/**
 * Reserved key for the rollout baseline, held in the same file as the real
 * session marks. A session id is a uuid, a tmux name or a native rollout id,
 * so it can never collide with this.
 */
const BASELINE_KEY = "__baseline__";

const store = createReadWatermarkStore(() => join(PATHS.data, "session-reads.json"));

/**
 * Everything already indexed when a person first loads the roster is read.
 *
 * Without this, turning the feature on would mark a whole history unread at
 * once, and the first thing a new indicator ever did would be to be wrong. It
 * writes one row per person, not one per session, so the cost does not grow
 * with the size of the archive.
 */
export function ensureSessionReadBaseline(user: string | null | undefined, now = Date.now()): number {
  const key = readWatermarkUser(user);
  const existing = store.readThrough(key, BASELINE_KEY);
  if (existing != null) return existing;
  const max = maxIndexedMessageRowid() ?? 0;
  store.ensureBaseline(key, BASELINE_KEY, max, now);
  return max;
}

export type SessionUnreadMap = Map<string, boolean>;

/**
 * Unread state for a roster, in one pass.
 *
 * A row is unread when its newest assistant rowid is past BOTH this person's
 * mark for that session and the rollout baseline. Taking the higher of the two
 * is what stops a session read before the baseline was written from coming back
 * unread, and what stops a pre-baseline session from ever appearing unread.
 */
export function sessionUnreadMap(
  user: string | null | undefined,
  sessionIds: string[],
): SessionUnreadMap {
  const out: SessionUnreadMap = new Map();
  if (!sessionIds.length) return out;
  const key = readWatermarkUser(user);
  const baseline = ensureSessionReadBaseline(key);
  const marks = store.readThroughAll(key);
  const cursors = latestIndexedAssistantRowids(sessionIds);
  for (const sessionId of sessionIds) {
    const cursor = cursors.get(sessionId);
    if (cursor == null) {
      out.set(sessionId, false);
      continue;
    }
    out.set(sessionId, cursor > Math.max(marks.get(sessionId) ?? 0, baseline));
  }
  return out;
}

/** True when this one session holds output this person has not read. */
export function sessionUnread(user: string | null | undefined, sessionId: string): boolean {
  return sessionUnreadMap(user, [sessionId]).get(sessionId) ?? false;
}

/**
 * Mark one session read through its newest assistant turn.
 *
 * Reading the cursor here rather than taking it from the caller keeps the
 * decision on the side that owns the transcript: a client that is a few seconds
 * behind cannot mark a turn read that it never received.
 */
export function markSessionRead(
  user: string | null | undefined,
  sessionId: string,
  now = Date.now(),
): { readThroughRowid: number } {
  const key = readWatermarkUser(user);
  ensureSessionReadBaseline(key, now);
  const cursor = latestIndexedAssistantRowids([sessionId]).get(sessionId) ?? null;
  const mark = store.mark(key, sessionId, cursor, now);
  return { readThroughRowid: mark.readThroughRowid };
}
