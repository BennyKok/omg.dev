import { listSessions, type Session } from "./sessions.ts";

// Must exceed both the status-broadcast cadence (~1s) and the warm-refresh
// interval below so hot readers (live-ws status loop, monitor) hit a warm cache
// instead of triggering a blocking full rebuild on the event loop.
const LIST_SESSIONS_CACHE_TTL_MS = 3000;
const ACTIVE_REFRESH_INTERVAL_MS = 2500;
const ACTIVE_REFRESH_IDLE_MS = 30_000;

export type SessionListCache = {
  invalidate(): void;
  get(): Promise<Session[]>;
  noteClientActivity(): void;
  /**
   * Called after every invalidate(). Every write that changes what a scan
   * returns already calls invalidate(), so this is the one "a session changed"
   * signal. The live status broadcast listens here to push a change at once
   * instead of waiting for its next poll and the cache TTL.
   */
  onInvalidate(listener: () => void): () => void;
  /**
   * The newest scan that finished, even one an invalidate() has since retired,
   * stamped with the moment it STARTED. A reader that can account for what
   * changed after that moment (session admission adds the managed records
   * created since) gets a count without paying for a scan of its own.
   */
  latest(): { startedAt: number; sessions: Session[] } | null;
};

/**
 * Cache in front of the (expensive) session list scan.
 *
 * A scan is a snapshot of the moment it STARTED, not of the moment it finished:
 * listSessions walks the process table and every transcript head, which on a
 * loaded box takes seconds. Two things follow, and both used to be wrong here.
 *
 * 1. The entry is timestamped with `startedAt`. Stamping completion time
 *    credited a 4s scan with 4s of freshness it never had, so a snapshot taken
 *    before a session was created could be served as current for a full TTL
 *    after that session already existed.
 * 2. An in-flight scan that predates an `invalidate()` must not be adopted.
 *    Callers used to join `inflight` unconditionally, so a warm-refresh tick
 *    that began a moment before POST /api/sessions/new added the managed record
 *    would hand its pre-create list to the very refresh the client fires right
 *    after creating — and then install that as fresh. That is one half of the
 *    "I created a session and it takes seconds to show up" report: the create
 *    was instant, the list was not.
 *
 * Taking the scan as a parameter keeps this logic testable with a scan whose
 * start and finish the test controls, without mocking the sessions module.
 */
export function createSessionListCache(scan: () => Promise<Session[]>): SessionListCache {
  let cached: { at: number; sessions: Session[] } | null = null;
  let latest: { startedAt: number; sessions: Session[] } | null = null;
  let inflight: { epoch: number; promise: Promise<Session[]> } | null = null;
  let recentClientActivityAt = 0;
  const invalidateListeners = new Set<() => void>();
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  // Bumped by every mutation that changes what a scan would return. A scan only
  // owns the cache if the world has not moved under it since it started.
  let epoch = 0;

  function startScan(): Promise<Session[]> {
    const startedAt = Date.now();
    const scanEpoch = epoch;
    const promise = scan()
      .then((sessions) => {
        if (scanEpoch === epoch) cached = { at: startedAt, sessions };
        if (!latest || latest.startedAt <= startedAt) latest = { startedAt, sessions };
        return sessions;
      })
      .finally(() => {
        if (inflight?.promise === promise) inflight = null;
      });
    inflight = { epoch: scanEpoch, promise };
    return promise;
  }

  function refresh(): Promise<Session[]> {
    if (inflight && inflight.epoch === epoch) return inflight.promise;
    return startScan();
  }

  function stopWarmRefresh(): void {
    if (!refreshTimer) return;
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  function warmRefreshTick(): void {
    if (Date.now() - recentClientActivityAt > ACTIVE_REFRESH_IDLE_MS) {
      stopWarmRefresh();
      return;
    }
    void refresh().catch(() => {});
  }

  return {
    invalidate() {
      epoch += 1;
      cached = null;
      for (const listener of invalidateListeners) {
        try {
          listener();
        } catch (error) {
          console.warn("[session-cache] invalidate listener failed", error);
        }
      }
    },
    onInvalidate(listener) {
      invalidateListeners.add(listener);
      return () => invalidateListeners.delete(listener);
    },
    get() {
      if (cached && Date.now() - cached.at < LIST_SESSIONS_CACHE_TTL_MS)
        return Promise.resolve(cached.sessions);
      return refresh();
    },
    latest() {
      return latest;
    },
    noteClientActivity() {
      recentClientActivityAt = Date.now();
      if (refreshTimer) return;
      refreshTimer = setInterval(warmRefreshTick, ACTIVE_REFRESH_INTERVAL_MS);
      (refreshTimer as { unref?: () => void }).unref?.();
    },
  };
}

const sessionListCache = createSessionListCache(() => listSessions());

export function invalidateListSessionsCache(): void {
  sessionListCache.invalidate();
}

export function onListSessionsInvalidated(listener: () => void): () => void {
  return sessionListCache.onInvalidate(listener);
}

export function noteListSessionsClientActivity(): void {
  sessionListCache.noteClientActivity();
}

export function latestSessionScan(): { startedAt: number; sessions: Session[] } | null {
  return sessionListCache.latest();
}

export function listSessionsCached(): Promise<Session[]> {
  return sessionListCache.get();
}

/**
 * One listed session, for a caller that reads only its stable fields (cwd,
 * tmuxTarget, agent, tmuxName, botId, transcript).
 *
 * The cached list is at most a few seconds old and is invalidated by every
 * registry write, so a session it holds has the same stable fields as a fresh
 * scan. A full listSessions() costs 0.1 s idle and several seconds on a loaded
 * box, and per-session routes used to run one per request. A miss still pays
 * for a fresh scan, so a session created a moment ago is found.
 *
 * Not for a decision that reads live state (busy, admission, liveness before a
 * close or resume): a cached row can be seconds behind on those.
 */
export async function findListedSession(
  match: (session: Session) => boolean,
  source: { cached: () => Promise<Session[]>; fresh: () => Promise<Session[]> } = {
    cached: listSessionsCached,
    fresh: listSessions,
  },
): Promise<Session | undefined> {
  const cached = (await source.cached().catch(() => [] as Session[])).find(match);
  return cached ?? (await source.fresh()).find(match);
}
