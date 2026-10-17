/**
 * FRAME TIMES ON THE REAL SESSION SCREEN, for long-chat measurements.
 *
 * The long-transcript benchmark renders product rows in a FlatList of its
 * own. That isolates the row cost, but it is not the screen a reader uses:
 * no paging, no transcript window, no hold menus' screen-level re-renders,
 * no polls. This probe measures the session screen itself, in probe builds
 * only (see FOLLOW_PROBE_ENABLED), while a Maestro flow scrolls it.
 *
 * Only frames while the list is MOVING count: a scroll event or a content
 * change keeps the probe active for ACTIVE_MS. A plan spends most of its
 * wall time waiting for the next look, and idle frames would bury the
 * hitches in sixteen-millisecond noise.
 *
 * - UI: the UI thread's frame intervals, from a Reanimated frame callback in
 *   the overlay (follow-probe-view.tsx), copied here once a second.
 * - JS: requestAnimationFrame intervals on the JS thread. A long one is a
 *   render or a list update that blocked the JS thread.
 * - open: from the screen mounting to the transcript being revealed.
 * - page: the longest JS frame within PAGE_MS after the content grew by more
 *   than a line, which is what one older page costs to land.
 * - renders: how often the session screen itself rendered. Every render
 *   re-runs the inline renderItem for every mounted row, so a screen that
 *   renders on a timer pays for its whole window on that timer.
 *
 * Simulator numbers are not phone numbers. Compare builds on one device in
 * one sitting; the ratio is the finding.
 */
import { FOLLOW_PROBE_ENABLED } from "./follow-probe";

export const ACTIVE_MS = 400;
export const PAGE_MS = 700;
/** 4ms bins up to 200ms; the last bin holds everything slower. */
const BIN_MS = 4;
const BINS = 50;

export type FrameSnapshot = { bins: number[]; count: number; max: number; over25: number; over50: number };
export const emptySnapshot = (): FrameSnapshot => ({ bins: new Array<number>(BINS).fill(0), count: 0, max: 0, over25: 0, over50: 0 });
export const FRAME_BIN_MS = BIN_MS;
export const FRAME_BINS = BINS;

export type FrameSummary = { count: number; p50: number; p95: number; over25: number; over50: number; max: number };

/** A frame-interval histogram. Plain numbers, so a worklet can keep the same shape. */
export class FrameStats {
  bins = new Array<number>(BINS).fill(0);
  count = 0;
  max = 0;
  /** Exact counts for the two thresholds that matter; the bins are 4ms wide. */
  over25 = 0;
  over50 = 0;

  add(ms: number): void {
    this.bins[Math.min(BINS - 1, Math.floor(ms / BIN_MS))] += 1;
    this.count += 1;
    if (ms > 25) this.over25 += 1;
    if (ms > 50) this.over50 += 1;
    if (ms > this.max) this.max = ms;
  }

  /** Replace with a copy taken from the UI thread. */
  load(snapshot: FrameSnapshot): void {
    this.bins = snapshot.bins.slice(0, BINS);
    this.count = snapshot.count;
    this.max = snapshot.max;
    this.over25 = snapshot.over25;
    this.over50 = snapshot.over50;
  }

  /** The upper edge of the bin that holds the q-th frame: a slight overestimate. */
  quantile(q: number): number {
    if (!this.count) return 0;
    const rank = Math.ceil(this.count * q);
    let seen = 0;
    for (let i = 0; i < BINS; i += 1) {
      seen += this.bins[i];
      if (seen >= rank) return Math.min((i + 1) * BIN_MS, this.max);
    }
    return this.max;
  }

  summary(): FrameSummary {
    return {
      count: this.count,
      p50: this.quantile(0.5),
      p95: this.quantile(0.95),
      over25: this.over25,
      over50: this.over50,
      max: Math.round(this.max),
    };
  }
}

export class PerfProbe {
  readonly ui = new FrameStats();
  readonly js = new FrameStats();
  openMs: number | null = null;
  renders = 0;
  loadedRows = 0;
  pages = 0;
  pageJsMax = 0;
  private pageUntil = 0;
  private openStart = 0;
  private activeUntil = 0;
  private raf: number | null = null;
  private lastFrame: number | null = null;
  private activeListener: ((active: boolean) => void) | null = null;
  /** The overlay clears the UI thread's copy when a session opens. */
  resetListener: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly now: () => number = () => performance.now(),
    private readonly frame: (callback: () => void) => number = (cb) => requestAnimationFrame(cb),
    private readonly cancelFrame: (id: number) => void = (id) => cancelAnimationFrame(id),
  ) {}

  /** The screen opened a session: a new measurement. */
  reset(): void {
    this.stop();
    this.ui.load(emptySnapshot());
    this.js.load(emptySnapshot());
    this.resetListener?.();
    this.openMs = null;
    this.renders = 0;
    this.pages = 0;
    this.pageJsMax = 0;
    this.pageUntil = 0;
    this.openStart = this.now();
  }

  /** The session screen rendered, with this many rows in its list. */
  render(rows: number): void {
    this.renders += 1;
    this.loadedRows = rows;
  }

  /** The content grew by `delta` points: older rows, or a new message. */
  grew(delta: number): void {
    if (delta <= 40) return;
    this.pages += 1;
    this.pageUntil = this.now() + PAGE_MS;
    this.activity();
  }

  opened(): void {
    if (this.openMs === null) this.openMs = Math.round(this.now() - this.openStart);
  }

  /** The overlay mirrors activity into the UI thread's frame callback. */
  onActive(listener: ((active: boolean) => void) | null): void {
    this.activeListener = listener;
  }

  /** A scroll event or a content change: the list is moving. */
  activity(): void {
    this.activeUntil = this.now() + ACTIVE_MS;
    if (this.raf === null) {
      this.lastFrame = null;
      this.activeListener?.(true);
      this.raf = this.frame(this.tick);
    }
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.idle(), ACTIVE_MS + 50);
  }

  private tick = () => {
    const at = this.now();
    if (this.lastFrame !== null) {
      const gap = at - this.lastFrame;
      this.js.add(gap);
      if (at <= this.pageUntil + gap && gap > this.pageJsMax) this.pageJsMax = gap;
    }
    this.lastFrame = at;
    if (at > this.activeUntil) {
      this.stop();
      return;
    }
    this.raf = this.frame(this.tick);
  };

  private idle(): void {
    if (this.now() >= this.activeUntil) this.stop();
  }

  private stop(): void {
    if (this.raf !== null) this.cancelFrame(this.raf);
    this.raf = null;
    this.lastFrame = null;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.activeListener?.(false);
  }
}

export const perfProbe: PerfProbe | null = FOLLOW_PROBE_ENABLED ? new PerfProbe() : null;

export function perfLines(probe: PerfProbe, mountedRows: number): string[] {
  const line = (name: string, s: FrameSummary) =>
    `Perf ${name}: ${s.count} frames, p50 ${s.p50}ms, p95 ${s.p95}ms, over 25ms ${s.over25}, over 50ms ${s.over50}, max ${s.max}ms`;
  return [
    line("UI", probe.ui.summary()),
    line("JS", probe.js.summary()),
    `Perf open ${probe.openMs ?? "-"}ms, mounted rows ${mountedRows}, loaded rows ${probe.loadedRows}`,
    `Perf growth ${probe.pages} times, worst JS frame after one ${Math.round(probe.pageJsMax)}ms, screen renders ${probe.renders}`,
  ];
}
