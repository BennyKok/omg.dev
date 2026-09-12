import type { OmgSession, OmgStatusRow } from "@omg-dev/protocol";

/** Status frames are partial rows, not a replacement fleet. */
export function patchSessionStatus(sessions: OmgSession[], rows: readonly OmgStatusRow[]): OmgSession[] {
  const patches = new Map<string, OmgStatusRow>();
  for (const row of rows) {
    if (!row.sessionId) continue;
    const defined = Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
    patches.set(row.sessionId, { ...patches.get(row.sessionId), ...defined, sessionId: row.sessionId });
  }
  let changed = false;
  const next = sessions.map((session) => {
    const patch = session.sessionId ? patches.get(session.sessionId) : undefined;
    if (!patch) return session;
    const fields = Object.entries(patch).filter(([, value]) => value !== undefined);
    if (fields.every(([key, value]) => session[key as keyof OmgSession] === value)) return session;
    changed = true;
    return { ...session, ...Object.fromEntries(fields) };
  });
  return changed ? next : sessions;
}

/**
 * What a batch of status frames means for the REST list.
 *
 * `unknown` is a session the list has never seen, so the roster is missing a
 * row and has to be refetched NOW.
 *
 * `settled` is a session this list already holds finishing its turn. It needs a
 * refetch too, but for a different reason and on a different clock: read state
 * is stamped per viewer by `/api/sessions` (see omg/session-unread.ts) and
 * status frames carry none of it, so an unread reply would otherwise wait for
 * the next periodic reconciliation — up to a minute while the socket is live.
 * It is not urgent enough to spend a request on every frame, so the observer
 * coalesces these.
 */
export type StatusApplyResult = {
  unknown: boolean;
  settled: boolean;
};

/** One list owner merges REST with status frames received during the request. */
export class SessionStatusState {
  private sessions: OmgSession[] = [];
  private pending: Promise<void> | null = null;
  private duringRequest: OmgStatusRow[] = [];
  private refreshAgain = false;
  private unknown = new Set<string>();

  constructor(private readonly changed: (sessions: OmgSession[]) => void) {}

  apply(rows: readonly OmgStatusRow[]): StatusApplyResult {
    if (this.pending) this.duringRequest.push(...rows);
    const known = new Map(this.sessions.map((session) => [session.sessionId, session]));
    let needsRefresh = false;
    let settled = false;
    for (const row of rows) {
      if (!row.sessionId) continue;
      if (!known.has(row.sessionId) && !this.unknown.has(row.sessionId)) {
        this.unknown.add(row.sessionId);
        needsRefresh = true;
        continue;
      }
      // A turn finishing, on a row already on screen. Whether it left an
      // unread reply behind is a question only the REST list can answer.
      if (row.busy === false && known.get(row.sessionId)?.busy) settled = true;
    }
    if (needsRefresh && this.pending) this.refreshAgain = true;
    const next = patchSessionStatus(this.sessions, rows);
    if (next !== this.sessions) {
      this.sessions = next;
      this.changed(next);
    }
    return { unknown: needsRefresh, settled };
  }

  remove(sessionId: string): void {
    this.sessions = this.sessions.filter((session) => session.sessionId !== sessionId);
    this.changed(this.sessions);
  }

  refresh(fetch: () => Promise<OmgSession[]>): Promise<void> {
    if (this.pending) return this.pending;
    this.duringRequest = [];
    this.pending = Promise.resolve().then(async () => {
      do {
        this.refreshAgain = false;
        const fresh = await fetch();
        this.sessions = patchSessionStatus(fresh, this.duringRequest);
        for (const row of fresh) if (row.sessionId) this.unknown.delete(row.sessionId);
        this.changed(this.sessions);
      } while (this.refreshAgain);
    }).finally(() => {
      this.pending = null;
      this.duringRequest = [];
    });
    return this.pending;
  }
}

/** One focused Home observer; the caller stops it on blur or background. */
export function observeSessionStatus(options: {
  live: Pick<import("@omg-dev/client").OmgLiveConnection, "state" | "subscribeStatus" | "subscribeConnection">;
  apply: (rows: OmgStatusRow[]) => StatusApplyResult;
  refresh: (quiet: boolean) => void;
  connectionChanged: (status: import("@omg-dev/client").OmgConnectionStatus) => void;
  /**
   * How long to hold a finished turn before refetching the list. One window
   * per burst, not one request per frame: a tree of subagents reporting in
   * together is one refresh, and a chatty session mid-turn is none at all.
   */
  settleRefreshMs?: number;
}, timer: { start: (tick: () => void) => () => void } = {
  start: (tick) => { const id = setInterval(tick, 10_000); return () => clearInterval(id); },
}): () => void {
  let stopped = false;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let receivedStatus = false;
  let connection = options.live.state.status;
  let ticks = 0;
  options.refresh(false);
  const offConnection = options.live.subscribeConnection((state) => {
    if (stopped) return;
    options.connectionChanged(state.status);
    if (state.status === "live" && connection !== "live") options.refresh(true);
    if (state.status !== "live") receivedStatus = false;
    connection = state.status;
  });
  const offStatus = options.live.subscribeStatus((rows) => {
    if (stopped) return;
    receivedStatus = true;
    const result = options.apply(rows);
    // A missing row is a hole in the list: refetch immediately.
    if (result.unknown) {
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      options.refresh(true);
      return;
    }
    // A finished turn only changes per-viewer state the frames do not carry.
    // One timer per burst; a second settle inside the window rides along.
    if (result.settled && !settleTimer) {
      settleTimer = setTimeout(() => {
        settleTimer = null;
        if (!stopped) options.refresh(true);
      }, options.settleRefreshMs ?? 600);
    }
  });
  const offTimer = timer.start(() => {
    if (stopped) return;
    ticks += 1;
    if (!receivedStatus || connection !== "live" || ticks % 6 === 0) options.refresh(true);
  });
  return () => {
    if (stopped) return;
    stopped = true;
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    offTimer();
    offStatus();
    offConnection();
  };
}
