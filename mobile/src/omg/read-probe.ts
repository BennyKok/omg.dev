/**
 * A WITNESS FOR THE READING POSITION, for the history-hold simulator plan.
 *
 * Scrolling up a long session loads older messages above the reader: first
 * the rows the screen already holds (the transcript window widens), then
 * pages from the machine, with a spinner above them while each one is in
 * flight. None of that may move what the reader is looking at. The screen
 * leans on the scroll view's maintainVisibleContentPosition for this, which
 * anchors to a mounted row; when that row goes away, or the anchor is the
 * wrong view, the list keeps its offset and the reader is thrown somewhere
 * else.
 *
 * A scroll offset cannot tell those apart — a correct hold CHANGES the offset
 * by exactly the height that arrived — so this watches what the reader sees.
 * When the list comes to rest it picks the first row whose top is on screen
 * below the bar, then measures that row in window coordinates every
 * SAMPLE_MS. While nobody touches the list, the row must stay where it was:
 *
 * - a MOVE is the anchor's top shifting by more than MOVE_PT and staying
 *   there for the next sample too;
 * - a FLICKER is a shift that the very next sample undoes. It is reported,
 *   not failed: one sample cannot tell a one-frame flash from a measurement
 *   taken mid-transaction (one read 3121pt, the whole content height, on a
 *   frame the video shows still). The recording is the evidence for those.
 * - a LOSS is the anchor row being unmounted under a reader at rest.
 *
 * An ARRIVAL is the content growing by more than MOVE_PT during the watch:
 * older rows landing. A watch with no arrival proves nothing and says so.
 *
 * The verdict freezes WATCH_MS after the list came to rest. A new drag
 * starts a new watch. The tracker is pure; ReadProbe adds the measuring.
 */
import { FOLLOW_PROBE_ENABLED } from "./follow-probe";

export const MOVE_PT = 40;
export const READ_WATCH_MS = 12_000;
const SAMPLE_MS = 100;

export type ReadReport = {
  state: "idle" | "anchoring" | "watching" | "done";
  moves: number;
  flickers: number;
  losses: number;
  arrivals: number;
  /** Whether any row was ever found to watch. */
  anchored: boolean;
  /** Since the screen opened: finished watches with arrivals that held, and that did not. */
  heldLoads: number;
  failedLoads: number;
  log: string[];
};

export class ReadTracker {
  private state: ReadReport["state"] = "idle";
  private start = 0;
  private key: string | null = null;
  private y = 0;
  private moves = 0;
  private flickers = 0;
  /** A shift seen once, waiting for the next sample to confirm or undo it. */
  private pending: number | null = null;
  private losses = 0;
  private arrivals = 0;
  private anchored = false;
  private heldLoads = 0;
  private failedLoads = 0;
  private height = 0;
  private log: string[] = [];

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** The list came to rest: a new watch, with no anchor yet. */
  begin(): void {
    this.tick(); // A watch that ran its course is counted before a new one.
    this.state = "anchoring";
    this.start = this.now();
    this.key = null;
    this.moves = 0;
    this.flickers = 0;
    this.pending = null;
    this.losses = 0;
    this.arrivals = 0;
    this.anchored = false;
    this.log = [];
  }

  /** The list's content height, whenever it changes. */
  content(height: number): void {
    this.tick();
    const grew = height - this.height;
    this.height = height;
    if ((this.state === "anchoring" || this.state === "watching") && grew > MOVE_PT) this.arrivals += 1;
  }

  /** A finger is on the list again: its motion is the reader's own. */
  end(): void {
    this.tick();
    if (this.state === "anchoring" || this.state === "watching") this.state = "idle";
  }

  anchorKey(): string | null {
    return this.state === "watching" ? this.key : null;
  }

  needsAnchor(): boolean {
    this.tick();
    return this.state === "anchoring";
  }

  anchor(key: string, y: number): void {
    if (this.state !== "anchoring") return;
    this.key = key;
    this.y = y;
    this.anchored = true;
    this.state = "watching";
  }

  /** The anchor's top in window points, or null when the row is gone. */
  observe(y: number | null): void {
    this.tick();
    if (this.state !== "watching") return;
    if (y === null) {
      this.pending = null;
      this.losses += 1;
      this.note(`row ${this.key} left the screen`);
      // Re-anchor on whatever is there now, so one loss is one failure.
      this.state = "anchoring";
      this.key = null;
      return;
    }
    const moved = y - this.y;
    if (this.pending !== null) {
      if (Math.abs(moved) <= MOVE_PT) {
        this.flickers += 1;
        this.note(`row ${this.key} flickered ${Math.round(this.pending)}pt for one sample`);
      } else {
        this.moves += 1;
        this.note(`row ${this.key} moved ${Math.round(moved)}pt`);
        this.y = y;
      }
      this.pending = null;
      return;
    }
    if (Math.abs(moved) > MOVE_PT) this.pending = moved;
  }

  report(): ReadReport {
    this.tick();
    return {
      state: this.state, moves: this.moves, flickers: this.flickers, losses: this.losses,
      arrivals: this.arrivals, anchored: this.anchored, log: this.log.slice(),
      heldLoads: this.heldLoads, failedLoads: this.failedLoads,
    };
  }

  private tick(): void {
    if ((this.state === "anchoring" || this.state === "watching") && this.now() - this.start >= READ_WATCH_MS) {
      // A shift nobody undid before the end is a move.
      if (this.pending !== null) {
        this.moves += 1;
        this.pending = null;
      }
      this.state = "done";
      if (this.arrivals > 0 || this.moves > 0 || this.losses > 0) {
        if (this.moves || this.losses || !this.anchored) this.failedLoads += 1;
        else this.heldLoads += 1;
      }
    }
  }

  private note(line: string): void {
    const at = ((this.now() - this.start) / 1000).toFixed(1);
    this.log = [...this.log, `${at}s ${line}`].slice(-4);
  }
}

type Measurable = { measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void };

/** The tracker plus the native measuring, driven by the session screen. */
export class ReadProbe {
  readonly tracker: ReadTracker;
  private rows = new Map<string, Measurable>();
  private refs = new Map<string, (view: Measurable | null) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Only a drag the reader started can come to rest. App scrolls end too. */
  private touching = false;
  private listeners = new Set<() => void>();
  /** Window y below which a row counts as on screen: the bottom of the bar. */
  top = 0;

  constructor(now?: () => number) {
    this.tracker = new ReadTracker(now);
  }

  /** A stable ref callback per row key, so React does not churn it. */
  ref(key: string): (view: Measurable | null) => void {
    let callback = this.refs.get(key);
    if (!callback) {
      callback = (view) => {
        if (view) this.rows.set(key, view);
        else this.rows.delete(key);
      };
      this.refs.set(key, callback);
    }
    return callback;
  }

  /** Rows the list has mounted right now (each registers its view). */
  mounted(): number {
    return this.rows.size;
  }

  reset(): void {
    this.touching = false;
    this.stop();
    this.tracker.end();
    this.rows.clear();
    this.refs.clear();
    this.emit();
  }

  content(height: number): void {
    this.tracker.content(height);
  }

  dragStart(): void {
    this.touching = true;
    this.stop();
    this.tracker.end();
    this.emit();
  }

  settle(): void {
    if (!this.touching) return;
    this.touching = false;
    this.tracker.begin();
    this.stop();
    this.timer = setInterval(() => this.sample(), SAMPLE_MS);
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private sample(): void {
    if (this.tracker.needsAnchor()) {
      let best: { key: string; y: number } | null = null;
      let pending = this.rows.size;
      if (!pending) return;
      for (const [key, view] of this.rows) {
        view.measureInWindow((_x, y, _w, height) => {
          if (height > 0 && y >= this.top && (!best || y < best.y)) best = { key, y };
          pending -= 1;
          if (pending === 0 && best) {
            this.tracker.anchor(best.key, best.y);
            this.emit();
          }
        });
      }
      return;
    }
    const key = this.tracker.anchorKey();
    if (!key) {
      if (this.tracker.report().state === "done") this.stop();
      this.emit();
      return;
    }
    const view = this.rows.get(key);
    if (!view) {
      this.tracker.observe(null);
      this.emit();
      return;
    }
    view.measureInWindow((_x, y) => {
      this.tracker.observe(y);
      this.emit();
    });
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** One probe for the one session screen on show. Null unless a probe build. */
// The keyboard fixture watches bottom-following, not history insertion. Its
// final reply is taller than the exposed viewport, so there is no row top for
// this history-load probe to anchor. The follow probe still judges every scroll.
export const readProbe: ReadProbe | null = FOLLOW_PROBE_ENABLED &&
  process.env.EXPO_PUBLIC_OMG_KEYBOARD_FIXTURE !== "1" ? new ReadProbe() : null;

/** Every load judged since the screen opened, for the plan's last step. */
export function readTotals(report: ReadReport): string {
  return `Reading totals: ${report.heldLoads} held loads, ${report.failedLoads} failed loads`;
}

/** The line the plan asserts on. */
export function readVerdict(report: ReadReport): string {
  if (report.state === "idle") return "Reading check idle";
  if (report.state === "anchoring" || report.state === "watching") return "Reading check watching";
  if (!report.anchored) return "Reading check failed: no row on screen to watch";
  const counts = `${report.moves} moves, ${report.losses} lost rows, ${report.arrivals} arrivals, ${report.flickers} flickers`;
  if (report.moves || report.losses) return `Reading check failed: ${counts}`;
  return report.arrivals ? `Reading check passed: ${counts}` : `Reading check empty: nothing loaded above`;
}
