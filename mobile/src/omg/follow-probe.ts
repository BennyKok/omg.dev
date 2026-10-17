/**
 * A WITNESS FOR THE FOLLOW-TO-BOTTOM, for the scroll-follow simulator plan.
 *
 * On 2026-10-16 an iPhone recording showed a working session's transcript
 * jumping about 470pt up and gliding back down every second or two, with no
 * finger on the glass and no new message arriving, and the "Latest" pill
 * flashing during each glide. That is a native layout effect: no DOM test can
 * see it, and a screenshot only catches it by luck. So the session screen,
 * when this fixture is on, reports every scroll and content-size event here,
 * and this decides — in plain code, from numbers — whether the list moved on
 * its own.
 *
 * What counts, and only after the reader has dragged once, let go, and is
 * back at the bottom (the screen's own `userMovedRef` rule, so the opening
 * pin is not judged, and a list that is not following is not judged either):
 *
 * - a JUMP: the offset moves UP by more than JUMP_PT between two scroll
 *   events while nobody is touching the list. A follow-to-bottom only ever
 *   moves down; upward motion without a finger is the glitch.
 * - a LATEST FLASH: the screen decides "not at the bottom" while nobody is
 *   touching the list. That is the pill appearing for a scroll the app made.
 * - a SHRINK: the content height drops by more than JUMP_PT. Not a defect on
 *   its own, but it is the suspected cause, so it is counted for diagnosis.
 *
 * The watch starts at the first moment after the drag that the list is at
 * the bottom, by the screen's own 48pt rule. The verdict is frozen WATCH_MS
 * later, so the plan reads a fixed answer. A new drag starts a new watch.
 */

/** On for the follow fixture, or for any build made with EXPO_PUBLIC_OMG_SCROLL_PROBE=1. */
export const FOLLOW_PROBE_ENABLED =
  process.env.EXPO_PUBLIC_OMG_FOLLOW_FIXTURE === "1" || process.env.EXPO_PUBLIC_OMG_SCROLL_PROBE === "1";

/** Bigger than a scroll-event step during a glide, smaller than one line of text. */
export const JUMP_PT = 40;
export const WATCH_MS = 20_000;
/** The session screen's own at-bottom tolerance (see onScroll there). */
const BOTTOM_PT = 48;

export type FollowReport = {
  state: "idle" | "away" | "watching" | "done";
  watchedMs: number;
  jumps: number;
  latestFlashes: number;
  shrinks: number;
  /** The few most recent events, newest last, for the screen and the video. */
  log: string[];
};

export class FollowProbe {
  private touching = false;
  private armed = false;
  private watching = false;
  private frozen = false;
  private geometryAtBottom = true;
  private watchStart = 0;
  private lastOffset: number | null = null;
  private lastHeight = 0;
  private atBottom = true;
  private jumps = 0;
  private latestFlashes = 0;
  private shrinks = 0;
  private log: string[] = [];
  private listeners = new Set<() => void>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  reset(): void {
    this.touching = false;
    this.armed = false;
    this.watching = false;
    this.frozen = false;
    this.geometryAtBottom = true;
    this.watchStart = 0;
    this.lastOffset = null;
    this.lastHeight = 0;
    this.atBottom = true;
    this.clearCounts();
    this.emit();
  }

  dragStart(): void {
    this.touching = true;
  }

  /** A drag released with no velocity, or a coast that has come to rest. */
  settle(): void {
    if (!this.touching) return;
    this.touching = false;
    this.armed = true;
    this.watching = false;
    this.frozen = false;
    this.clearCounts();
    this.startIfAtBottom();
    this.emit();
  }

  scroll(offset: number, contentHeight: number, viewportHeight: number): void {
    this.tick();
    const previous = this.lastOffset;
    this.lastOffset = offset;
    this.geometryAtBottom = offset + viewportHeight >= contentHeight - BOTTOM_PT;
    this.startIfAtBottom();
    if (!this.judging() || previous === null) return;
    const up = previous - offset;
    if (up > JUMP_PT) {
      this.jumps += 1;
      this.note(`jump ${Math.round(up)}pt up, offset ${Math.round(offset)}, content ${Math.round(contentHeight)}`);
    }
  }

  content(height: number): void {
    this.tick();
    const previous = this.lastHeight;
    this.lastHeight = height;
    if (!this.judging() || !previous) return;
    const drop = previous - height;
    if (drop > JUMP_PT) {
      this.shrinks += 1;
      this.note(`content shrank ${Math.round(drop)}pt to ${Math.round(height)}`);
    }
  }

  /** The screen's own at-bottom verdict, as it hands it to the Latest pill. */
  bottom(atBottom: boolean): void {
    this.tick();
    const was = this.atBottom;
    this.atBottom = atBottom;
    if (this.judging() && was && !atBottom) {
      this.latestFlashes += 1;
      this.note("Latest shown without a drag");
    }
  }

  report(): FollowReport {
    this.tick();
    const state = !this.armed ? "idle" : !this.watching ? "away" : this.frozen ? "done" : "watching";
    const watchedMs = this.watching ? Math.min(WATCH_MS, this.now() - this.watchStart) : 0;
    return {
      state,
      watchedMs,
      jumps: this.jumps,
      latestFlashes: this.latestFlashes,
      shrinks: this.shrinks,
      log: this.log.slice(),
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private judging(): boolean {
    return this.watching && !this.touching && !this.frozen;
  }

  private startIfAtBottom(): void {
    if (!this.armed || this.touching || this.watching || !this.geometryAtBottom) return;
    this.watching = true;
    this.watchStart = this.now();
    this.atBottom = true;
    this.emit();
  }

  /** Freeze the verdict once the watch window has passed. */
  private tick(): void {
    if (this.watching && !this.frozen && !this.touching && this.now() - this.watchStart >= WATCH_MS) {
      this.frozen = true;
      this.emit();
    }
  }

  private clearCounts(): void {
    this.jumps = 0;
    this.latestFlashes = 0;
    this.shrinks = 0;
    this.log = [];
  }

  private note(line: string): void {
    const at = ((this.now() - this.watchStart) / 1000).toFixed(1);
    this.log = [...this.log, `${at}s ${line}`].slice(-4);
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** One probe for the one session screen on show. Null unless the fixture is on. */
export const followProbe: FollowProbe | null = FOLLOW_PROBE_ENABLED ? new FollowProbe() : null;

/** The line the plan asserts on. Exact strings, so a count cannot hide in a substring. */
export function followVerdict(report: FollowReport): string {
  if (report.state === "idle") return "Follow check idle: drag the transcript once";
  if (report.state === "away") return "Follow check waiting: return to the latest message";
  if (report.state === "watching") return `Follow check watching ${Math.floor(report.watchedMs / 1000)} s`;
  const clean = report.jumps === 0 && report.latestFlashes === 0;
  const counts = `${report.jumps} jumps, ${report.latestFlashes} Latest flashes, ${report.shrinks} shrinks`;
  return clean ? `Follow check passed: ${counts}` : `Follow check failed: ${counts}`;
}
