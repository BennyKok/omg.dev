// The relay client's view of local serve changes.
//
// `lfg connect` forwards session lifecycle, fleet status, ships, findings and
// ask-user questions to the relay. It used to learn about them by fetching the
// four full lists from local serve every 4 s, forever: about 200 KB of JSON per
// tick, and the single largest source of /api/sessions and /api/auto/findings
// traffic on a box (one call every ~3 s each, all day).
//
// Local serve already pushes exactly these facts on its live socket
// (/api/live/ws): `status` frames with the rows whose busy/status/title moved,
// and `changed` frames naming the lists that changed (sessions roster, auto,
// ask). So connect holds one local socket and reads a list only when that
// list changed. A slow backstop read stays, because every frame here is
// best-effort, and the old fixed poll returns whenever the socket is down.

/** The status-row fields connect reads; see OmgStatusRow in the protocol. */
export type LocalStatusRow = {
  sessionId: string | null;
  busy?: boolean;
  title?: string | null;
  status?: "ok" | "blocked";
};

export type LocalFeedHandlers = {
  /** The socket opened (true) or dropped (false). */
  onLive?(live: boolean): void;
  /** Lists that changed. Empty means "re-read everything" (sent on open). */
  onChanged?(topics: string[]): void;
  /** Rows whose status fields changed; the first frame after open is the full fleet. */
  onStatus?(rows: LocalStatusRow[]): void;
};

type SocketLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "message" | "close" | "error", listener: (event: any) => void): void;
};

export type LocalFeedOptions = {
  createSocket?: (url: string) => SocketLike;
  minRetryMs?: number;
  maxRetryMs?: number;
};

export type LocalFeed = { isLive(): boolean; close(): void };

const OPEN = 1;

/** Hold one reconnecting socket to local serve's live channel. */
export function openLocalChangeFeed(
  url: string,
  handlers: LocalFeedHandlers,
  options: LocalFeedOptions = {},
): LocalFeed {
  const createSocket = options.createSocket ?? ((target: string) => new WebSocket(target) as unknown as SocketLike);
  const minRetryMs = options.minRetryMs ?? 1_000;
  const maxRetryMs = options.maxRetryMs ?? 30_000;
  let socket: SocketLike | null = null;
  let live = false;
  let closed = false;
  let retryMs = minRetryMs;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const setLive = (next: boolean) => {
    if (live === next) return;
    live = next;
    try { handlers.onLive?.(next); } catch {}
  };

  const connect = () => {
    if (closed) return;
    let ws: SocketLike;
    try {
      ws = createSocket(url);
    } catch {
      scheduleRetry();
      return;
    }
    socket = ws;
    ws.addEventListener("open", () => {
      if (socket !== ws) return;
      retryMs = minRetryMs;
      setLive(true);
    });
    ws.addEventListener("message", (event) => {
      if (socket !== ws || typeof event?.data !== "string") return;
      let frame: any;
      try { frame = JSON.parse(event.data); } catch { return; }
      if (!frame || typeof frame !== "object") return;
      try {
        if (frame.t === "ping") {
          // The server closes a socket with no client traffic for 60 s.
          ws.send(JSON.stringify({ t: "pong", ...(frame.id ? { id: frame.id } : {}) }));
        } else if (frame.t === "changed" && Array.isArray(frame.topics)) {
          handlers.onChanged?.(frame.topics.filter((topic: unknown): topic is string => typeof topic === "string"));
        } else if (frame.t === "status" && Array.isArray(frame.rows)) {
          handlers.onStatus?.(frame.rows);
        }
      } catch {}
    });
    const drop = () => {
      if (socket !== ws) return;
      socket = null;
      setLive(false);
      scheduleRetry();
    };
    ws.addEventListener("close", drop);
    ws.addEventListener("error", () => {
      try { ws.close(); } catch {}
      drop();
    });
  };

  const scheduleRetry = () => {
    if (closed || retryTimer) return;
    const delay = retryMs;
    retryMs = Math.min(maxRetryMs, retryMs * 2);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
    (retryTimer as { unref?: () => void }).unref?.();
  };

  connect();
  return {
    isLive: () => live && socket?.readyState === OPEN,
    close() {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      const ws = socket;
      socket = null;
      live = false;
      try { ws?.close(); } catch {}
    },
  };
}

export type CoalescedRunner = {
  /** Run soon: now if idle and past the gap, else once after the current run or the gap. */
  request(): void;
  /** When the last run started; 0 before the first. */
  lastRunAt(): number;
};

/**
 * Serialise one read: never two at once, at most one per `minGapMs`, and any
 * number of requests during a run or a gap collapse into a single follow-up.
 */
export function coalescedRunner(
  run: () => Promise<void>,
  minGapMs: number,
  now: () => number = Date.now,
): CoalescedRunner {
  let running = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = 0;
  const start = () => {
    timer = null;
    pending = false;
    running = true;
    last = now();
    void run().catch(() => {}).finally(() => {
      running = false;
      if (pending) schedule();
    });
  };
  const schedule = () => {
    if (running || timer) {
      pending = true;
      return;
    }
    const wait = Math.max(0, last + minGapMs - now());
    if (wait === 0 || last === 0) {
      start();
      return;
    }
    timer = setTimeout(start, wait);
    (timer as { unref?: () => void }).unref?.();
  };
  return { request: schedule, lastRunAt: () => last };
}
