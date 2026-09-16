/**
 * When the Home Screen village changes pose.
 *
 * No imports, deliberately: village-widget-data.ts reaches expo-asset,
 * expo-file-system and expo-widgets, and importing any of those pulls in React
 * Native, which the check harness cannot parse. The rule below is the part
 * with real behaviour in it, so it lives where a test can reach it.
 */
/**
 * The four walk poses, one per timeline entry. WidgetKit does not run a render
 * loop, so this is the only motion a Home Screen widget can express, and the
 * system decides when it actually redraws.
 */
export const WALK_PHASES = 4;

/**
 * How many entries one write covers.
 *
 * This used to be WALK_PHASES, so a write bought exactly four redraws and the
 * village then froze until the app next came forward. Cycling the four poses
 * over more entries buys the same wall-clock window at a shorter step, which
 * is what makes a change visible between two glances. Every entry carries a
 * full copy of the props, so this is also what the timeline costs in the App
 * Group defaults — do not raise it without measuring that.
 */
export const WALK_ENTRIES = 8;

/**
 * One timeline entry per pose, `stepMs` apart, cycling the poses.
 *
 * ── THE PHASE COMES FROM THE CLOCK, NOT FROM THE ENTRY INDEX ──────────────
 *
 * It used to be `index % WALK_PHASES`, which meant every write started the
 * cycle again at pose 0. That is fine if a write is rare. It is not: the
 * bridge rewrites the timeline on every status change, and again every 30
 * seconds while the app is in the foreground (see widgetRefresh). Each rewrite
 * put a fresh pose-0 entry at `now`, so the pose being displayed was pinned at
 * 0 for as long as anybody was using the app, and the agents stood still on
 * the exact spot they start from. Benny: "I still dont see it strolling left
 * and right."
 *
 * Deriving the pose from the entry's own wall-clock time makes a rewrite
 * IDEMPOTENT with respect to the walk: the same instant always gets the same
 * pose, whoever wrote it and however many times. The village keeps pacing
 * across rewrites instead of restarting, and two glances a step apart differ.
 */
export function walkPhaseAt(time: number, stepMs: number): number {
  return Math.floor(time / stepMs) % WALK_PHASES;
}

export function walkTimeline<T extends { walkPhase: number }>(
  props: Omit<T, "walkPhase">,
  stepMs: number,
  from: Date = new Date(),
  count: number = WALK_ENTRIES,
): { date: Date; props: T }[] {
  const entries: { date: Date; props: T }[] = [];
  for (let index = 0; index < count; index += 1) {
    const date = new Date(from.getTime() + index * stepMs);
    entries.push({
      date,
      props: { ...props, walkPhase: walkPhaseAt(date.getTime(), stepMs) } as T,
    });
  }
  return entries;
}
/**
 * Whether the widget's timeline is worth rewriting.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * The bridge calls `updateTimeline` on every status change AND again every 30
 * seconds while the app is in the foreground, and each call ends in
 * `reloadTimelines(ofKind:)`. Apple is explicit that reloading far more often
 * than a widget's content changes gets the widget's refreshes throttled -- the
 * budget is a few dozen a day, not a few dozen a minute. So the surface most
 * likely to be starved of redraws was the one asking for them hardest, and the
 * village sat still.
 *
 * The walk itself no longer needs a write: `walkPhaseAt` derives the pose from
 * wall-clock time, so the poses already in the timeline keep advancing on
 * their own. A write is therefore only needed when the CONTENT changed, or
 * when the timeline is running out of entries.
 *
 * `windowMs` is how much wall clock one write covers. Rewriting at half of it
 * leaves a full margin before the last entry comes due, so the village never
 * reaches the end and freezes on the final pose.
 */
export function shouldWriteTimeline(
  last: { signature: string; at: number } | null,
  signature: string,
  now: number,
  windowMs: number,
): boolean {
  if (!last) return true;
  if (last.signature !== signature) return true;
  return now - last.at >= windowMs / 2;
}

/** How much wall clock one write covers. */
export function timelineWindowMs(stepMs: number): number {
  return WALK_ENTRIES * stepMs;
}
